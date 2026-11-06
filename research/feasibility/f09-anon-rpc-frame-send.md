# F9. Does the Anon-RPC worker pass `eth_sendFrameTransaction` through?

**Verdict:** open

## Why it matters

The payment send is the one call where the user's IP would link to a payment, which is
the link the design exists to cut. If the worker allowlists RPC methods, the new method
may be dropped.

**If it fails:** patch the worker's method list if it's ours to run, or declare the send
as a deliberate exclusion, which weakens the design's main privacy claim.

## How to settle

- Read the worker source for a method allowlist.
- Send a frame tx through the harness to the gateway and confirm it lands.

## Findings

## Evidence
