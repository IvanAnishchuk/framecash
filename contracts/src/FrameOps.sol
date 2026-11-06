// SPDX-License-Identifier: CC0-1.0 OR Apache-2.0 OR WTFPL
pragma solidity ^0.8.28;

/**
 * @title FrameOps
 * @notice Raw-bytecode helpers for the EIP-8141 opcodes that solc cannot emit.
 * @dev Each helper is a runtime of a few bytes. A contract deploys them once and calls them:
 *      the read helpers by staticcall (the opcodes are transaction-scoped, so any contract
 *      sees the same values), APPROVE by delegatecall (it only succeeds as `tx.sender`).
 *      `probes/f04-signer-not-sender` showed the pattern on the devnet.
 *
 *      Runtimes, with calldata words w0, w1:
 *      APPROVER     APPROVE(scope = w0, offset 0, length 0)
 *      TXPARAM      return TXPARAM(w0)
 *      SIGPARAM     return SIGPARAM(param = w0, signatureIndex = w1)
 *      FRAMEPARAM   return FRAMEPARAM(param = w0, frameIndex = w1)
 *      FRAMEDATA    return the whole data of frame w0 (FRAMEPARAM 0x04 for the length, then
 *                   FRAMEDATACOPY)
 */
library FrameOps {
    bytes internal constant APPROVER = hex"60003560006000aa";
    bytes internal constant TXPARAM = hex"600035b060005260206000f3";
    bytes internal constant SIGPARAM = hex"600035602035b460005260206000f3";
    bytes internal constant FRAMEPARAM = hex"600035602035b360005260206000f3";
    bytes internal constant FRAMEDATA = hex"60003580600490b380919060006000b26000f3";

    address internal constant ENTRY_POINT = address(0xaa);

    // EIP-8141 TXPARAM indices, and the EIP-8250 additions.
    uint256 internal constant TX_NONCE_SEQ = 0x01;
    uint256 internal constant TX_MAX_COST = 0x06;
    uint256 internal constant TX_FRAME_COUNT = 0x09;
    uint256 internal constant TX_CURRENT_FRAME = 0x0a;
    uint256 internal constant TX_SIGNATURE_COUNT = 0x0b;
    uint256 internal constant TX_NONCE_KEY_COUNT = 0x0e;
    uint256 internal constant TX_NONCE_KEY_0 = 0x10;

    uint256 internal constant SIG_SIGNER = 0x00;
    uint256 internal constant SIG_SCHEME = 0x01;
    uint256 internal constant SIG_MSG = 0x02;

    uint256 internal constant FRAME_TARGET = 0x00;
    uint256 internal constant FRAME_MODE = 0x02;
    uint256 internal constant FRAME_VALUE = 0x08;

    uint256 internal constant MODE_SENDER = 2;
    uint256 internal constant SCHEME_SECP256K1 = 1;
    uint256 internal constant SCOPE_BOTH = 3;

    error HelperFailed(address helper);

    /// @notice Wrap a runtime of under 256 bytes in init code and CREATE it.
    function deploy(bytes memory runtime) internal returns (address a) {
        bytes memory init = abi.encodePacked(
            hex"60", uint8(runtime.length), hex"600c600039", hex"60", uint8(runtime.length), hex"6000f3", runtime
        );
        assembly {
            a := create(0, add(init, 32), mload(init))
        }
        if (a == address(0)) revert HelperFailed(address(0));
    }

    function word(address helper, bytes memory input) internal view returns (uint256) {
        (bool ok, bytes memory r) = helper.staticcall(input);
        if (!ok || r.length != 32) revert HelperFailed(helper);
        return abi.decode(r, (uint256));
    }

    function bytesOf(address helper, bytes memory input) internal view returns (bytes memory r) {
        bool ok;
        (ok, r) = helper.staticcall(input);
        if (!ok) revert HelperFailed(helper);
    }
}
