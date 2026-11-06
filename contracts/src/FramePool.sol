// SPDX-License-Identifier: CC0-1.0 OR Apache-2.0 OR WTFPL
pragma solidity ^0.8.28;

import {BLS} from "./BLS.sol";
import {FrameOps} from "./FrameOps.sol";

/// @notice The receiver interface of the CRE forwarder.
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice The ERC-8421 staking registry on the devnet. It keys every stake on msg.sender.
interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}

/**
 * @title FramePool
 * @notice Blind-signature eCash notes that pay their own gas, as EIP-8141 frame transactions.
 * @dev Deposit and mint follow teecash's BlindMint: a depositor sends value and blinded G2
 *      points, the mint blind-signs some of them with one BLS key per denomination, and
 *      announces the signatures. The client unblinds and holds notes `(a, d, S)`, where
 *      `A = address(a)` and `S` is the mint's signature over `A`.
 *
 *      Paying is new. The note holder sends a frame transaction whose sender is this pool:
 *
 *          nonce_keys = [noteKey(d, A)]   nonce_seq = noteSeq
 *          signatures = [SECP256K1, signer A, canonical sig hash]
 *          frame 0    VERIFY, target pool, data validate()
 *          frame 1    SENDER, target pool, data spend(d, A, S, payee, amount, changeBlinds)
 *
 *      `validate` runs in the validation prefix and checks the whole shape, the note key and
 *      the mint signature, then approves execution and payment: the pool pays the gas. The
 *      protocol verified A's signature over the canonical hash, which covers the fees, both
 *      frames and the nonce key, so nobody else can redirect or reprice the payment.
 *
 *      The nonce key is the nullifier. EIP-8250 consumes it at payment approval, so a second
 *      spend of the same note fails the protocol's nonce check. The pool reads no storage
 *      that a payment writes, so concurrent payments cannot invalidate each other.
 *
 *      `spend` never reverts: the nonce is consumed and the gas charged once frame 0
 *      approves, so a revert would burn the note while the pool still paid. A failed payout
 *      turns into change. Change becomes a new deposit against `changeBlinds`, which the mint
 *      signs like any other.
 */
contract FramePool is IReceiver {
    using FrameOps for address;

    enum Status {
        None,
        Pending,
        Announced,
        Refunded
    }

    struct Deposit {
        address depositor;
        uint96 amount;
        uint32 points;
        uint64 deadline;
        Status status;
    }

    struct Spend {
        uint256 denom;
        address note;
        bytes sig;
        address payee;
        uint256 amount;
        bytes[] changeBlinds;
    }

    uint256 public constant MAX_POINTS = 256;
    /// @dev Execution gas a payee gets. A payee that needs more receives change instead.
    uint256 public constant PAYEE_GAS = 50_000;
    bytes32 public constant NOTE_TAG = keccak256("framecash.note.v1");

    mapping(uint256 => bytes) public mintPubkeys;
    mapping(uint256 => Deposit) public deposits;

    address public immutable forwarder;
    address public immutable treasury;
    uint64 public immutable refundDelay;
    uint256 public immutable rung;
    /// @notice The nonce_seq every payment must carry. 0 is sequential first use; EIP-8250's
    ///         single-use form is MAX_NONCE_SEQ. Either way the key works once, because the
    ///         pool accepts only this value and the protocol moves the key past it.
    uint64 public immutable noteSeq;

    address public immutable approver;
    address public immutable txParam;
    address public immutable sigParam;
    address public immutable frameParam;
    address public immutable frameData;

    bytes public dst;
    uint256 public nextId = 1;
    uint256 public totalAnnounced;
    uint256 public totalSpent;

    event Deposited(uint256 indexed id, address indexed depositor, uint256 amount, bytes[] blindedPoints);
    event Announced(uint256 indexed id, uint256[] pointIndexes, uint256[] denoms, bytes[] blindSigs);
    event Spent(
        address indexed note, uint256 denom, address indexed payee, uint256 amount, bool paid, uint256 change, uint256 changeId
    );
    event Overdrawn(address indexed note, uint256 denom);
    event Refunded(uint256 indexed id, address indexed depositor, uint256 amount);
    event Taxed(uint256 indexed id, uint256 amount);

    error NotForwarder();
    error NotEntryPoint();
    error NotSelf();
    error NoPoints();
    error NoValue();
    error NoTreasury();
    error AmountTooLarge();
    error TooManyPoints(uint256 got, uint256 max);
    error BadDeposit(uint256 id);
    error LengthMismatch();
    error SumMismatch(uint256 got, uint256 want);
    error PointIndexOutOfRange(uint256 index);
    error PointIndexRepeated(uint256 index);
    error UnknownDenomination(uint256 denom);
    error TooEarly(uint64 deadline);
    error TransferFailed(address to);
    error BadShape(uint256 check);
    error BadSigner(address got, address want);
    error BadNonce();
    error FeeTooHigh(uint256 maxCost, uint256 room);
    error BadSignature();

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert NotForwarder();
        _;
    }

    /**
     * @param forwarder_ The address that announces: the CRE forwarder, or the mint key itself.
     * @param treasury_ Receives the mint tax.
     * @param refundDelay_ How long a depositor waits before reclaiming an unminted deposit.
     * @param denoms The denomination ladder.
     * @param pubkeys One G1 public key per denomination, in the same order.
     * @param noteSeq_ The nonce_seq of every payment (see `noteSeq`).
     * @param registry The staking registry, or zero to skip staking (tests).
     * @param stake The stake, taken from msg.value. The rest funds the pool's gas.
     * @param unstakeDelay The registry's unstake delay in seconds.
     */
    constructor(
        address forwarder_,
        address treasury_,
        uint64 refundDelay_,
        uint256[] memory denoms,
        bytes[] memory pubkeys,
        uint64 noteSeq_,
        address registry,
        uint256 stake,
        uint32 unstakeDelay
    ) payable {
        if (denoms.length != pubkeys.length || denoms.length == 0) revert LengthMismatch();
        if (treasury_ == address(0)) revert NoTreasury();
        forwarder = forwarder_;
        treasury = treasury_;
        refundDelay = refundDelay_;
        noteSeq = noteSeq_;
        uint256 smallest = type(uint256).max;
        for (uint256 i = 0; i < denoms.length; i++) {
            if (denoms[i] == 0) revert UnknownDenomination(0);
            if (pubkeys[i].length != BLS.G1_BYTES) revert BLS.BadLength(pubkeys[i].length, BLS.G1_BYTES);
            mintPubkeys[denoms[i]] = pubkeys[i];
            if (denoms[i] < smallest) smallest = denoms[i];
        }
        rung = smallest;
        dst = _buildDst();

        approver = FrameOps.deploy(FrameOps.APPROVER);
        txParam = FrameOps.deploy(FrameOps.TXPARAM);
        sigParam = FrameOps.deploy(FrameOps.SIGPARAM);
        frameParam = FrameOps.deploy(FrameOps.FRAMEPARAM);
        frameData = FrameOps.deploy(FrameOps.FRAMEDATA);

        // A pool stakes itself here. The registry keys the stake on msg.sender, the pool.
        if (registry != address(0)) IStakingRegistry(registry).addStake{value: stake}(unstakeDelay);
    }

    /// @notice Top up the gas reserve. Refunds of change deposits also land here.
    receive() external payable {}

    // -----------------------------------------------------------------------------------
    // Add money: deposit and mint. Ordinary transactions.
    // -----------------------------------------------------------------------------------

    /**
     * @notice The value a deposit of `amount` mints. The rest, one rung plus everything
     *         below it, is the mint tax that pays for the announcement.
     */
    function mintable(uint256 amount) public view returns (uint256) {
        if (amount < rung) return 0;
        return (amount / rung - 1) * rung;
    }

    /// @notice Lock value against blinded points. Send more points than the split needs.
    function deposit(bytes[] calldata blindedPoints) external payable returns (uint256 id) {
        if (msg.value == 0) revert NoValue();
        if (blindedPoints.length == 0 && mintable(msg.value) != 0) revert NoPoints();
        if (blindedPoints.length > MAX_POINTS) revert TooManyPoints(blindedPoints.length, MAX_POINTS);
        if (msg.value > type(uint96).max) revert AmountTooLarge();
        for (uint256 i = 0; i < blindedPoints.length; i++) {
            if (blindedPoints[i].length != BLS.G2_BYTES) revert BLS.BadLength(blindedPoints[i].length, BLS.G2_BYTES);
        }
        id = _record(msg.sender, msg.value, blindedPoints);
    }

    /// @notice Publish the blind signatures for one deposit. Their denominations must sum
    ///         to `mintable(amount)`.
    function announce(uint256 id, uint256[] calldata pointIndexes, uint256[] calldata denoms, bytes[] calldata blindSigs)
        external
        onlyForwarder
    {
        _announce(id, pointIndexes, denoms, blindSigs);
    }

    /// @notice ERC-165. The CRE forwarder checks it before it delivers a report.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == type(IReceiver).interfaceId;
    }

    /// @notice Receive an announcement as a CRE report: abi(id, pointIndexes, denoms, blindSigs).
    function onReport(bytes calldata, bytes calldata report) external onlyForwarder {
        (uint256 id, uint256[] memory pointIndexes, uint256[] memory denoms, bytes[] memory blindSigs) =
            abi.decode(report, (uint256, uint256[], uint256[], bytes[]));
        _announce(id, pointIndexes, denoms, blindSigs);
    }

    /// @notice Return a pending deposit when the mint refuses to sign it.
    function refundByMint(uint256 id) external onlyForwarder {
        _refund(id);
    }

    /// @notice Return a pending deposit after the delay. A dead mint cannot keep the money.
    function refundByDepositor(uint256 id) external {
        Deposit storage d = deposits[id];
        if (d.depositor != msg.sender) revert BadDeposit(id);
        if (block.timestamp < d.deadline) revert TooEarly(d.deadline);
        _refund(id);
    }

    // -----------------------------------------------------------------------------------
    // Pay: one frame transaction with the pool as sender.
    // -----------------------------------------------------------------------------------

    /// @notice The nonce key, and so the nullifier, of note `A` of denomination `denom`.
    function noteKey(uint256 denom, address note) public view returns (uint256) {
        return uint256(keccak256(abi.encode(NOTE_TAG, block.chainid, address(this), denom, note)));
    }

    /**
     * @notice Frame 0 of a payment (VERIFY). Approves execution and payment when the
     *         transaction is exactly one valid note spend. Any failure reverts, which makes
     *         the transaction invalid: nothing is charged and the note stays unspent.
     * @dev Reads only this contract's code and the storage the constructor wrote. No payment
     *      writes any of it, so no payment can invalidate another one. Not `view` only
     *      because of the APPROVE delegatecall; the protocol runs VERIFY frames static.
     */
    function validate() external {
        if (msg.sender != FrameOps.ENTRY_POINT) revert NotEntryPoint();
        _checkShape();
        Spend memory s = _spendArgs();

        // The protocol verified the note key's signature over the canonical sig hash.
        if (_tx(FrameOps.TX_SIGNATURE_COUNT) != 1) revert BadShape(10);
        if (_sig(FrameOps.SIG_SCHEME) != FrameOps.SCHEME_SECP256K1) revert BadShape(11);
        if (_sig(FrameOps.SIG_MSG) != 0) revert BadShape(12);
        address signer = address(uint160(_sig(FrameOps.SIG_SIGNER)));
        if (signer != s.note) revert BadSigner(signer, s.note);

        // The nullifier: one key, the note's own, at the one accepted sequence. EIP-8250
        // requires single-use keys to be authenticated exactly like this.
        if (_tx(FrameOps.TX_NONCE_KEY_COUNT) != 1) revert BadNonce();
        if (_tx(FrameOps.TX_NONCE_KEY_0) != noteKey(s.denom, s.note)) revert BadNonce();
        if (_tx(FrameOps.TX_NONCE_SEQ) != noteSeq) revert BadNonce();

        // The note covers the payout and the worst-case gas.
        uint256 maxCost = _tx(FrameOps.TX_MAX_COST);
        if (s.amount > s.denom || maxCost > s.denom - s.amount) revert FeeTooHigh(maxCost, s.denom - s.amount);
        if (s.changeBlinds.length > MAX_POINTS) revert TooManyPoints(s.changeBlinds.length, MAX_POINTS);
        for (uint256 i = 0; i < s.changeBlinds.length; i++) {
            if (s.changeBlinds[i].length != BLS.G2_BYTES) revert BadShape(20);
        }

        bytes memory pubkey = mintPubkeys[s.denom];
        if (pubkey.length == 0) revert UnknownDenomination(s.denom);
        if (s.sig.length != BLS.G2_BYTES) revert BadShape(21);
        if (!BLS.verify(pubkey, s.note, s.sig, dst)) revert BadSignature();

        (bool ok,) = approver.delegatecall(abi.encode(FrameOps.SCOPE_BOTH));
        if (!ok) revert BadShape(30);
    }

    /**
     * @notice Frame 1 of a payment (SENDER). Pays `amount` to `payee` and turns the rest,
     *         less the worst-case gas, into a change deposit. Never reverts.
     * @dev Only the pool itself reaches this: a SENDER frame calls as `tx.sender`, and the
     *      pool approved execution only after `validate` checked these exact arguments. The
     *      parameters match the struct `Spend`, so `validate` can decode this frame's data.
     */
    function spend(
        uint256 denom,
        address note,
        bytes calldata,
        address payee,
        uint256 amount,
        bytes[] calldata changeBlinds
    ) external {
        if (msg.sender != address(this)) revert NotSelf();
        uint256 change = denom - amount - _tx(FrameOps.TX_MAX_COST);

        // Inflation circuit breaker: a mint signing off-band cannot drain more than was
        // announced. The note is spent either way.
        totalSpent += denom;
        if (totalSpent > totalAnnounced) {
            emit Overdrawn(note, denom);
            return;
        }

        // No return data is copied, so a payee cannot burn the frame's gas with a huge reply.
        bool paid;
        assembly {
            paid := call(PAYEE_GAS, payee, amount, 0, 0, 0, 0)
        }
        if (!paid) change += amount;

        uint256 changeId;
        if (change != 0 && changeBlinds.length != 0 && mintable(change) != 0) {
            changeId = _record(address(this), change, changeBlinds);
        }
        // Change that cannot mint stays in the pool and pays for later gas.
        emit Spent(note, denom, payee, paid ? amount : 0, paid, change, changeId);
    }

    // -----------------------------------------------------------------------------------
    // Internals.
    // -----------------------------------------------------------------------------------

    /// @dev Exactly two frames, this is frame 0, and frame 1 calls `spend` on the pool as
    ///      sender with no value. Without this a SENDER frame could move the pool's balance.
    function _checkShape() private view {
        if (_tx(FrameOps.TX_FRAME_COUNT) != 2) revert BadShape(1);
        if (_tx(FrameOps.TX_CURRENT_FRAME) != 0) revert BadShape(2);
        if (_frame(FrameOps.FRAME_MODE, 1) != FrameOps.MODE_SENDER) revert BadShape(3);
        if (_frame(FrameOps.FRAME_TARGET, 1) != uint256(uint160(address(this)))) revert BadShape(4);
        if (_frame(FrameOps.FRAME_VALUE, 1) != 0) revert BadShape(5);
    }

    /// @dev Decode frame 1's data as `spend` arguments.
    function _spendArgs() private view returns (Spend memory s) {
        bytes memory data = frameData.bytesOf(abi.encode(uint256(1)));
        if (data.length < 4 || bytes4(data) != this.spend.selector) revert BadShape(6);
        // Drop the selector in place: move the length word forward by four bytes.
        bytes memory args;
        assembly {
            args := add(data, 4)
            mstore(args, sub(mload(data), 4))
        }
        (s.denom, s.note, s.sig, s.payee, s.amount, s.changeBlinds) =
            abi.decode(args, (uint256, address, bytes, address, uint256, bytes[]));
    }

    function _tx(uint256 param) private view returns (uint256) {
        return txParam.word(abi.encode(param));
    }

    function _sig(uint256 param) private view returns (uint256) {
        return sigParam.word(abi.encode(param, uint256(0)));
    }

    function _frame(uint256 param, uint256 index) private view returns (uint256) {
        return frameParam.word(abi.encode(param, index));
    }

    function _record(address depositor, uint256 amount, bytes[] calldata points) private returns (uint256 id) {
        id = nextId++;
        deposits[id] = Deposit({
            depositor: depositor,
            amount: uint96(amount),
            points: uint32(points.length),
            deadline: uint64(block.timestamp) + refundDelay,
            status: Status.Pending
        });
        emit Deposited(id, depositor, amount, points);
    }

    function _announce(uint256 id, uint256[] memory pointIndexes, uint256[] memory denoms, bytes[] memory blindSigs)
        private
    {
        Deposit storage d = deposits[id];
        if (d.status != Status.Pending) revert BadDeposit(id);
        if (pointIndexes.length != denoms.length || denoms.length != blindSigs.length) revert LengthMismatch();

        uint256 sum;
        uint256 seen;
        for (uint256 i = 0; i < pointIndexes.length; i++) {
            uint256 idx = pointIndexes[i];
            if (idx >= d.points) revert PointIndexOutOfRange(idx);
            uint256 bit = 1 << idx;
            if (seen & bit != 0) revert PointIndexRepeated(idx);
            seen |= bit;
            if (mintPubkeys[denoms[i]].length == 0) revert UnknownDenomination(denoms[i]);
            if (blindSigs[i].length != BLS.G2_BYTES) revert BLS.BadLength(blindSigs[i].length, BLS.G2_BYTES);
            sum += denoms[i];
        }
        uint256 want = mintable(d.amount);
        if (sum != want) revert SumMismatch(sum, want);

        uint256 taken = d.amount - sum;
        d.status = Status.Announced;
        totalAnnounced += sum;
        emit Announced(id, pointIndexes, denoms, blindSigs);
        if (taken != 0) {
            emit Taxed(id, taken);
            _send(treasury, taken);
        }
    }

    function _refund(uint256 id) private {
        Deposit storage d = deposits[id];
        if (d.status != Status.Pending) revert BadDeposit(id);
        d.status = Status.Refunded;
        uint256 amount = d.amount;
        address to = d.depositor;
        emit Refunded(id, to, amount);
        if (to != address(this)) _send(to, amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to);
    }

    /// @dev Must equal `dst()` in lib/src/bls/domain.ts for the same chain and address.
    function _buildDst() private view returns (bytes memory) {
        return abi.encodePacked(
            "FRAMECASH_V1_",
            _toString(block.chainid),
            "_",
            _toHexAddress(address(this)),
            "_BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_"
        );
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 v = value; v != 0; v /= 10) {
            digits++;
        }
        bytes memory out = new bytes(digits);
        for (uint256 v = value; v != 0; v /= 10) {
            out[--digits] = bytes1(uint8(48 + (v % 10)));
        }
        return string(out);
    }

    function _toHexAddress(address a) private pure returns (string memory) {
        bytes memory hexDigits = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 v = uint160(a);
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(v >> (8 * (19 - i)));
            out[2 + i * 2] = hexDigits[b >> 4];
            out[3 + i * 2] = hexDigits[b & 0x0f];
        }
        return string(out);
    }
}
