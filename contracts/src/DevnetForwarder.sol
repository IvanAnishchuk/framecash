// SPDX-License-Identifier: CC0-1.0 OR Apache-2.0 OR WTFPL
pragma solidity ^0.8.28;

interface IReportReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title DevnetForwarder
 * @notice A stand-in for Chainlink's MockKeystoneForwarder on a chain CRE has no forwarder
 *         for. `cre workflow simulate --broadcast` writes reports by calling `report` on the
 *         forwarder that project.yaml names for the chain; this contract delivers them.
 * @dev Same entry point and split as the Keystone forwarder: the raw report is 109 bytes of
 *      metadata followed by the workflow's payload. The receiver gets metadata bytes 45..109
 *      (workflow CID, name, owner, report id) and the payload. Like the mock, it checks no
 *      DON signatures: the simulation produces none that a devnet could verify. So anyone can
 *      deliver a report through it, and a pool that trusts it trusts every caller.
 *      That is acceptable on a throwaway devnet only, and the README says so.
 */
contract DevnetForwarder {
    uint256 internal constant METADATA_LENGTH = 109;
    uint256 internal constant FORWARDER_METADATA_LENGTH = 45;

    event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result);

    error ReportTooShort(uint256 length);

    function report(address receiver, bytes calldata rawReport, bytes calldata, bytes[] calldata) external {
        if (rawReport.length < METADATA_LENGTH) revert ReportTooShort(rawReport.length);
        bytes32 executionId = bytes32(rawReport[1:33]);
        bytes2 reportId = bytes2(rawReport[107:109]);
        // Unlike Keystone, a failing receiver reverts the write, so a simulation that
        // announced nothing does not report success.
        IReportReceiver(receiver).onReport(rawReport[FORWARDER_METADATA_LENGTH:METADATA_LENGTH], rawReport[METADATA_LENGTH:]);
        emit ReportProcessed(receiver, executionId, reportId, true);
    }

    function typeAndVersion() external pure returns (string memory) {
        return "DevnetForwarder 1.0.0";
    }
}
