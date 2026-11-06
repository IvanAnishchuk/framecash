# F9. Does the Anon-RPC worker pass `eth_sendFrameTransaction` through?

**Verdict:** fails over Nym, with a known cause (probe, 2026-11-07). The harness passes the
method; the Nym worker drops the request's `content-type`, and Skandha refuses the request.

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

- No method allowlist anywhere on the path: through the harness with the passthrough
  worker, Skandha admitted the payment and it was included (block 10430).
- Over Nym, Skandha answered `-32600 Unsupported Media Type: undefined`. The harness
  serializes request headers (`dist/host.js` 0.4.0, lines 243–253), so the header is lost
  in the Nym worker or at its exit. ethrex ignores the missing header, which is why reads
  and deposits work over Nym.
- tor-js could not be tried (F8).

**What the design does now.** Reads and the deposit go over Nym. The payment send over Nym
fails, so the app's default anonymizing route cannot pay today. The app says so, and the
README lists the payment send as the open exclusion, with the cause. Fixes, cheapest first:
a working tor-js gateway; a header fix in the Nym worker (to report to Nym); Skandha
accepting a body without `content-type` (to ask the alt-mempool team).

## Evidence

- Probe: [`probes/f09-anon-rpc-frame-send/`](../../probes/f09-anon-rpc-frame-send/README.md)
