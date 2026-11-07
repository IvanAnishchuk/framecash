# F9. Does the Anon-RPC worker pass `eth_sendFrameTransaction` through?

**Verdict:** works over Nox (probe, 2026-11-07): the payment send goes to Skandha through the
Nox mixnet and is included. It fails over Nym, which drops the request's `content-type`.

**Nox result.** The app's whole flow ran over Nox, 43 calls in all and none outside it:
faucet, deposit, the CRE mint's notes read back, and the payment. Payment
`0x8c7be807d1fc76e69a1b9b856d94aee26996b80c62a1990381a25b246d8f0410` was sent with
`eth_sendFrameTransaction` to Skandha over Nox and included in block 11030, with the CRE
pool as payer. Nox's specifier lives on Sepolia; the design had misread that as Nox only
reaching Sepolia. Screenshot: `docs/screenshots/02-paid-over-nox.png`.

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
- Cause confirmed directly (2026-11-07): a POST to Skandha with no `content-type` returns
  the identical `-32600 Unsupported Media Type: undefined`, and ethrex answers the same
  request. ethrex has no `eth_sendFrameTransaction` (`-32601 Method not found`), so the send
  cannot detour through it.
- Where the header goes: the Nym worker (`@nymproject/anon-rpc-worker` 0.1.0, the bundle its
  specifier pins) copies the harness's headers through unchanged (`out.headers =
  init.headers`) into `@nymproject/mix-fetch` 3.0.0's `mixFetch`, which runs the request in
  its own tunnel worker. The harness hands headers over as a list of `[name, value]` pairs,
  so mix-fetch most likely does not read that form. Not confirmed: a later attempt to echo
  the headers through Nym (httpbin.org, postman-echo.com, httpbingo.org) timed out, as did
  devnet reads that had worked two hours earlier. Three tunnels on three gateways all
  reported ready and then carried nothing.

**What the design does now.** Reads and the deposit go over Nym. The payment send over Nym
fails, so the app's default anonymizing route cannot pay today. The app says so, and the
README lists the payment send as the open exclusion, with the cause. Fixes, cheapest first:
- a working tor-js gateway;
- Nym's worker converting the pair list to an object before `mixFetch` (to report to Nym);
- Skandha accepting a JSON body without `content-type` (to ask the alt-mempool team);
- a stateless relay in front of Skandha that adds the header. It would see only the
  mixnet exit's address, so privacy holds, but it needs public hosting.

## Evidence

- Probe: [`probes/f09-anon-rpc-frame-send/`](../../probes/f09-anon-rpc-frame-send/README.md)
