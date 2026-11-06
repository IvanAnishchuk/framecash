// SPDX-License-Identifier: CC0-1.0 OR Apache-2.0 OR WTFPL
pragma solidity ^0.8.28;

/// @dev The few forge cheatcodes these tests use, declared here so the repo needs no
///      external test library.
interface Vm {
    function ffi(string[] calldata cmd) external returns (bytes memory);
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function deal(address who, uint256 amount) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata data) external;
    function expectRevert(bytes4 selector) external;
    function toString(address value) external pure returns (string memory);
    function toString(bytes calldata value) external pure returns (string memory);
    function toString(uint256 value) external pure returns (string memory);
}

abstract contract Cheats {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev forge prints these ds-test events with -vv.
    event log_named_uint(string key, uint256 val);

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function assertEq(bytes memory a, bytes memory b, string memory what) internal pure {
        require(keccak256(a) == keccak256(b), what);
    }

    function assertTrue(bool ok, string memory what) internal pure {
        require(ok, what);
    }
}

/// @dev Stands in for a TXPARAM/SIGPARAM/FRAMEPARAM helper: answers whatever word the test
///      stored for the exact calldata the pool sends.
contract MockParams {
    mapping(bytes32 => uint256) internal v;

    function put(bytes calldata key, uint256 value) external {
        v[keccak256(key)] = value;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        return abi.encode(v[keccak256(input)]);
    }
}

/// @dev Stands in for the FRAMEDATA helper: returns the frame data the test stored.
contract MockFrameData {
    bytes internal data;

    function put(bytes calldata d) external {
        data = d;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        return data;
    }
}

contract Reverter {
    receive() external payable {
        revert("no");
    }
}
