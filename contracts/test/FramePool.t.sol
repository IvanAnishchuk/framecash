// SPDX-License-Identifier: CC0-1.0 OR Apache-2.0 OR WTFPL
pragma solidity ^0.8.28;

import {FramePool} from "../src/FramePool.sol";
import {Cheats, MockFrameData, MockParams, Reverter} from "./Cheats.sol";

/**
 * Forge's EVM has no frame transactions, so the five opcode helpers are replaced with mocks
 * that return what a real frame tx would. The devnet run (cli `e2e`) covers the real ones.
 * BLS vectors come from the TypeScript library over FFI, through its blind path.
 */
contract FramePoolTest is Cheats {
    uint256 constant D1 = 0.001 ether;
    uint256 constant D2 = 0.01 ether;
    uint256 constant SK1 = 0x2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a;
    uint256 constant SK2 = 0x1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b;
    address constant TREASURY = address(0xbeef);
    address constant NOTE = 0x00000000000000000000000000000000DeaDBeef;
    address constant PAYEE = 0x000000000000000000000000000000000000cafE;
    uint256 constant MAX_COST = 1e12;

    FramePool pool;
    MockParams txp;
    MockParams sigp;
    MockParams framep;
    MockFrameData framed;
    bytes noteSig;

    function setUp() public {
        (bytes memory pk1,) = _vector(SK1, hex"00", NOTE);
        (bytes memory pk2,) = _vector(SK2, hex"00", NOTE);
        uint256[] memory denoms = new uint256[](2);
        denoms[0] = D1;
        denoms[1] = D2;
        bytes[] memory pks = new bytes[](2);
        pks[0] = pk1;
        pks[1] = pk2;
        vm.deal(address(this), 10 ether);
        pool = new FramePool{value: 1 ether}(address(this), TREASURY, 1 days, denoms, pks, 0, address(0), 0, 0);

        vm.etch(pool.approver(), hex"00"); // STOP: a delegatecall that approves nothing, successfully
        vm.etch(pool.txParam(), type(MockParams).runtimeCode);
        vm.etch(pool.sigParam(), type(MockParams).runtimeCode);
        vm.etch(pool.frameParam(), type(MockParams).runtimeCode);
        vm.etch(pool.frameData(), type(MockFrameData).runtimeCode);
        txp = MockParams(payable(pool.txParam()));
        sigp = MockParams(payable(pool.sigParam()));
        framep = MockParams(payable(pool.frameParam()));
        framed = MockFrameData(payable(pool.frameData()));

        (, noteSig) = _vector(SK2, pool.dst(), NOTE);
        _frameTx(D2, NOTE, noteSig, PAYEE, 0.004 ether, _blinds(3));
    }

    // ---------------------------------------------------------------------------------
    // Cross-language agreement.
    // ---------------------------------------------------------------------------------

    function test_dstMatchesTypeScript() public {
        string[] memory cmd = _cmd("dst");
        cmd[3] = vm.toString(block.chainid);
        cmd[4] = vm.toString(address(pool));
        assertEq(abi.decode(vm.ffi(cmd), (bytes)), pool.dst(), "dst differs from lib/src/bls/domain.ts");
    }

    function test_noteKeyMatchesTypeScript() public {
        string[] memory cmd = new string[](7);
        cmd[0] = "node";
        cmd[1] = "../lib/scripts/ffi.ts";
        cmd[2] = "notekey";
        cmd[3] = vm.toString(block.chainid);
        cmd[4] = vm.toString(address(pool));
        cmd[5] = vm.toString(D2);
        cmd[6] = vm.toString(NOTE);
        assertEq(abi.decode(vm.ffi(cmd), (uint256)), pool.noteKey(D2, NOTE), "noteKey differs from lib/src/pool.ts");
    }

    // ---------------------------------------------------------------------------------
    // validate: frame 0.
    // ---------------------------------------------------------------------------------

    function test_validateAcceptsOneNoteSpend() public {
        vm.prank(address(0xaa));
        uint256 before = gasleft();
        pool.validate();
        emit log_named_uint("validate gas (mocked helpers, cold)", before - gasleft());
    }

    function test_validateOnlyFromEntryPoint() public {
        vm.expectRevert(FramePool.NotEntryPoint.selector);
        pool.validate();
    }

    function test_validateRejectsWrongSigner() public {
        sigp.put(abi.encode(uint256(0), uint256(0)), uint256(uint160(PAYEE)));
        vm.prank(address(0xaa));
        vm.expectRevert(abi.encodeWithSelector(FramePool.BadSigner.selector, PAYEE, NOTE));
        pool.validate();
    }

    function test_validateRejectsForeignNonceKey() public {
        txp.put(abi.encode(uint256(0x10)), 12345);
        vm.prank(address(0xaa));
        vm.expectRevert(FramePool.BadNonce.selector);
        pool.validate();
    }

    function test_validateRejectsExtraNonceKeys() public {
        txp.put(abi.encode(uint256(0x0e)), 2);
        vm.prank(address(0xaa));
        vm.expectRevert(FramePool.BadNonce.selector);
        pool.validate();
    }

    function test_validateRejectsReusedSequence() public {
        txp.put(abi.encode(uint256(0x01)), 1);
        vm.prank(address(0xaa));
        vm.expectRevert(FramePool.BadNonce.selector);
        pool.validate();
    }

    function test_validateRejectsExtraFrame() public {
        txp.put(abi.encode(uint256(0x09)), 3);
        vm.prank(address(0xaa));
        vm.expectRevert(abi.encodeWithSelector(FramePool.BadShape.selector, 1));
        pool.validate();
    }

    function test_validateRejectsValueInSpendFrame() public {
        framep.put(abi.encode(uint256(0x08), uint256(1)), 1 ether);
        vm.prank(address(0xaa));
        vm.expectRevert(abi.encodeWithSelector(FramePool.BadShape.selector, 5));
        pool.validate();
    }

    function test_validateRejectsSpendFrameToAnotherTarget() public {
        framep.put(abi.encode(uint256(0x00), uint256(1)), uint256(uint160(PAYEE)));
        vm.prank(address(0xaa));
        vm.expectRevert(abi.encodeWithSelector(FramePool.BadShape.selector, 4));
        pool.validate();
    }

    function test_validateRejectsOtherCalldata() public {
        framed.put(abi.encodeCall(pool.deposit, (new bytes[](0))));
        vm.prank(address(0xaa));
        vm.expectRevert(abi.encodeWithSelector(FramePool.BadShape.selector, 6));
        pool.validate();
    }

    function test_validateRejectsSignatureOfAnotherDenomination() public {
        (, bytes memory sig1) = _vector(SK1, pool.dst(), NOTE);
        _frameTx(D2, NOTE, sig1, PAYEE, 0.004 ether, _blinds(1));
        vm.prank(address(0xaa));
        vm.expectRevert(FramePool.BadSignature.selector);
        pool.validate();
    }

    function test_validateRejectsFeeAboveTheNote() public {
        txp.put(abi.encode(uint256(0x06)), D2);
        vm.prank(address(0xaa));
        vm.expectRevert(abi.encodeWithSelector(FramePool.FeeTooHigh.selector, D2, D2 - 0.004 ether));
        pool.validate();
    }

    function test_validateRejectsBadChangePoint() public {
        bytes[] memory blinds = new bytes[](1);
        blinds[0] = hex"01";
        _frameTx(D2, NOTE, noteSig, PAYEE, 0.004 ether, blinds);
        vm.prank(address(0xaa));
        vm.expectRevert(abi.encodeWithSelector(FramePool.BadShape.selector, 20));
        pool.validate();
    }

    // ---------------------------------------------------------------------------------
    // spend: frame 1.
    // ---------------------------------------------------------------------------------

    function test_spendOnlyFromSelf() public {
        vm.expectRevert(FramePool.NotSelf.selector);
        pool.spend(D2, NOTE, noteSig, PAYEE, 1, new bytes[](0));
    }

    function test_spendPaysAndRecordsChange() public {
        _mintOne();
        uint256 id = pool.nextId();
        vm.prank(address(pool));
        pool.spend(D2, NOTE, noteSig, PAYEE, 0.004 ether, _blinds(3));
        assertEq(PAYEE.balance, 0.004 ether, "payee not paid");
        (address depositor, uint96 amount, uint32 points,, FramePool.Status status) = pool.deposits(id);
        assertTrue(depositor == address(pool), "change depositor");
        assertEq(amount, D2 - 0.004 ether - MAX_COST, "change amount");
        assertEq(points, 3, "change points");
        assertTrue(status == FramePool.Status.Pending, "change pending");
        assertEq(pool.totalSpent(), D2, "spent");
    }

    function test_spendNeverRevertsOnAFailingPayee() public {
        _mintOne();
        address payee = address(new Reverter());
        uint256 id = pool.nextId();
        vm.prank(address(pool));
        pool.spend(D2, NOTE, noteSig, payee, 0.004 ether, _blinds(3));
        (, uint96 amount,,,) = pool.deposits(id);
        assertEq(amount, D2 - MAX_COST, "failed payout became change");
    }

    function test_spendBeyondAnnouncedPaysNothing() public {
        vm.prank(address(pool));
        pool.spend(D2, NOTE, noteSig, PAYEE, 0.004 ether, _blinds(3));
        assertEq(PAYEE.balance, 0, "paid beyond announced");
    }

    // ---------------------------------------------------------------------------------
    // deposit and announce.
    // ---------------------------------------------------------------------------------

    function test_depositAnnounceTaxes() public {
        uint256 id = pool.deposit{value: 0.012 ether}(_blinds(4));
        uint256[] memory idx = new uint256[](2);
        idx[0] = 0;
        idx[1] = 2;
        uint256[] memory ds = new uint256[](2);
        ds[0] = D2;
        ds[1] = D1;
        bytes[] memory sigs = _blinds(2);
        pool.announce(id, idx, ds, sigs);
        assertEq(TREASURY.balance, D1, "tax");
        assertEq(pool.totalAnnounced(), 0.011 ether, "announced");
    }

    function test_announceRejectsWrongSum() public {
        uint256 id = pool.deposit{value: 0.012 ether}(_blinds(4));
        uint256[] memory idx = new uint256[](1);
        uint256[] memory ds = new uint256[](1);
        ds[0] = D2;
        vm.expectRevert(abi.encodeWithSelector(FramePool.SumMismatch.selector, D2, 0.011 ether));
        pool.announce(id, idx, ds, _blinds(1));
    }

    function test_refundAfterDelay() public {
        address user = address(0x1234);
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 id = pool.deposit{value: 0.012 ether}(_blinds(4));
        vm.warp(block.timestamp + 1 days);
        vm.prank(user);
        pool.refundByDepositor(id);
        assertEq(user.balance, 1 ether, "refund");
    }

    // ---------------------------------------------------------------------------------
    // Helpers.
    // ---------------------------------------------------------------------------------

    /// @dev Program the mocks to describe a valid one-note spend.
    function _frameTx(uint256 denom, address note, bytes memory sig, address payee, uint256 amount, bytes[] memory blinds)
        internal
    {
        framed.put(abi.encodeCall(pool.spend, (denom, note, sig, payee, amount, blinds)));
        txp.put(abi.encode(uint256(0x09)), 2);
        txp.put(abi.encode(uint256(0x0a)), 0);
        txp.put(abi.encode(uint256(0x0b)), 1);
        txp.put(abi.encode(uint256(0x0e)), 1);
        txp.put(abi.encode(uint256(0x10)), pool.noteKey(denom, note));
        txp.put(abi.encode(uint256(0x01)), 0);
        txp.put(abi.encode(uint256(0x06)), MAX_COST);
        sigp.put(abi.encode(uint256(0), uint256(0)), uint256(uint160(note)));
        sigp.put(abi.encode(uint256(1), uint256(0)), 1);
        sigp.put(abi.encode(uint256(2), uint256(0)), 0);
        framep.put(abi.encode(uint256(0x02), uint256(1)), 2);
        framep.put(abi.encode(uint256(0x00), uint256(1)), uint256(uint160(address(pool))));
        framep.put(abi.encode(uint256(0x08), uint256(1)), 0);
    }

    /// @dev Announce one D2 note's worth, so totalAnnounced covers a spend.
    function _mintOne() internal {
        uint256 id = pool.deposit{value: D2 + D1}(_blinds(1));
        uint256[] memory idx = new uint256[](1);
        uint256[] memory ds = new uint256[](1);
        ds[0] = D2;
        pool.announce(id, idx, ds, _blinds(1));
    }

    function _blinds(uint256 n) internal pure returns (bytes[] memory b) {
        b = new bytes[](n);
        for (uint256 i = 0; i < n; i++) {
            b[i] = new bytes(256);
        }
    }

    function _cmd(string memory sub) internal pure returns (string[] memory cmd) {
        cmd = new string[](5);
        cmd[0] = "node";
        cmd[1] = "../lib/scripts/ffi.ts";
        cmd[2] = sub;
    }

    function _vector(uint256 sk, bytes memory dst, address addr) internal returns (bytes memory pk, bytes memory sig) {
        string[] memory cmd = new string[](6);
        cmd[0] = "node";
        cmd[1] = "../lib/scripts/ffi.ts";
        cmd[2] = "vector";
        cmd[3] = vm.toString(sk);
        cmd[4] = vm.toString(dst);
        cmd[5] = vm.toString(addr);
        (pk, sig) = abi.decode(vm.ffi(cmd), (bytes, bytes));
    }

    receive() external payable {}
}
