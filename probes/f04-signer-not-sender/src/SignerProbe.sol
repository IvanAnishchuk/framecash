// SPDX-License-Identifier: CC0-1.0 OR Apache-2.0 OR WTFPL
pragma solidity ^0.8.28;

/**
 * @title SignerProbe
 * @notice Checks that stock solc can drive the EIP-8141 opcodes through raw-bytecode helpers.
 * @dev Solidity has no syntax for APPROVE (0xaa), TXPARAM (0xb0) or SIGPARAM (0xb4). This
 *      contract deploys three helpers of a few bytes each and calls them:
 *      - APPROVER runs APPROVE(scope from calldata). It must run as this contract, so it is
 *        reached by delegatecall.
 *      - TXPARAM_READER returns TXPARAM(param from calldata).
 *      - SIGNER_READER returns SIGPARAM(param 0 = resolved signer, signature 0).
 *
 *      The VERIFY frame (empty data) lands in `fallback`. It approves only when the protocol
 *      verified signature 0 for `owner`, a key that is not this contract. The SENDER frame
 *      calls `record`, which logs what the helpers return, so the receipt shows them.
 *
 *      Fund it through the creation value only. A plain transfer runs `fallback` outside a
 *      frame, and APPROVE then halts.
 */
contract SignerProbe {
    address public immutable owner;
    address public immutable approver;
    address public immutable txParamReader;
    address public immutable signerReader;

    event Seen(address signer, uint256 nonceSeq, uint256 nonceKeyCount, uint256 nonceKey0, bytes32 sigHash);

    constructor(address owner_) payable {
        owner = owner_;
        // CALLDATALOAD(0) as scope, then APPROVE(offset 0, length 0, scope).
        approver = _deploy(hex"60003560006000aa");
        // TXPARAM(CALLDATALOAD(0)), returned as one word.
        txParamReader = _deploy(hex"600035b060005260206000f3");
        // SIGPARAM(signature 0, param 0), returned as one word.
        signerReader = _deploy(hex"60006000b460005260206000f3");
    }

    fallback() external payable {
        require(msg.sender == address(0xaa), "not a frame");
        require(_signer() == owner, "bad signer");
        (bool ok,) = approver.delegatecall(abi.encode(uint256(3)));
        require(ok, "approve failed");
    }

    function record() external {
        require(msg.sender == address(this), "not self");
        emit Seen(_signer(), _txParam(0x01), _txParam(0x0e), _txParam(0x10), bytes32(_txParam(0x08)));
    }

    function _signer() private view returns (address) {
        (bool ok, bytes memory r) = signerReader.staticcall("");
        require(ok && r.length == 32, "sigparam failed");
        return abi.decode(r, (address));
    }

    function _txParam(uint256 p) private view returns (uint256) {
        (bool ok, bytes memory r) = txParamReader.staticcall(abi.encode(p));
        require(ok && r.length == 32, "txparam failed");
        return abi.decode(r, (uint256));
    }

    /// @dev Wrap a runtime of under 256 bytes in init code and CREATE it.
    function _deploy(bytes memory runtime) private returns (address a) {
        bytes memory init = abi.encodePacked(
            hex"60", uint8(runtime.length), hex"600c600039", hex"60", uint8(runtime.length), hex"6000f3", runtime
        );
        assembly {
            a := create(0, add(init, 32), mload(init))
        }
        require(a != address(0), "helper deploy failed");
    }
}
