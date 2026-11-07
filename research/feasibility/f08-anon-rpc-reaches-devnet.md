# F8. Can Anon-RPC's tor-js or Nym routes reach the `altmempool.wtf` hosts?

**Verdict:** works over Nox and over Nym (probe, 2026-11-07). tor-js: unknown, because
its demo gateway was unreachable. Nox is the app's default: `adopters.json5`'s `chainId`
11155111 for Nox is where its specifier lives, "not the chain the anonymized fetch can
reach". The design had misread it as a limit. Nox reached both devnet endpoints (ready in
about 4 s, ~1.5 s per call). Nym later stopped carrying any request (three tunnels, all
"ready", every fetch timed out at 00:33Z).

## Why it matters

The Anon-RPC track requires reads routed through it by default. The devnet RPC
(`devnet{1,2,3}.altmempool.wtf`) and the gateway (`gateway*.altmempool.wtf`) are the
only endpoints this app talks to. Nox is pinned to Sepolia.

**If it fails:** reads go over a plain connection, and the Anon-RPC track drops, unless
we run our own devnet RPC proxy behind a route that works.

## How to settle

- Load the browser harness, point the tor-js and Nym routes at each devnet host, and
  issue `eth_blockNumber` and `eth_getLogs`.
- Check whether the routes restrict destination hosts or ports.

## Findings

- The live devnet is `altmempool.forshtat.com` (ethrex) and `/rpc` (Skandha); the
  `*.altmempool.wtf` hosts did not answer (F1). Both answer CORS with `*`.
- **Nym** works: the worker booted in the browser harness, and every read plus a faucet
  transfer and a deposit reached ethrex through the mixnet and were mined.
- **tor-js** booted and verified, but its only configured gateway (the demonstration KPS
  relay in `adopters.json5`) timed out, so it never built a circuit. We looked and could
  not settle it. Ask the anon-rpc team on site for a working gateway, or run one.
- No route restricted destination hosts or ports.
- Node: the node harness gives its guest no WebAssembly, so tor-js and Nym cannot run in
  the CLI. The CLI is the operator tool and talks to the devnet directly; that exclusion is
  stated in the README.

## Evidence

- Probe: [`probes/f08-anon-rpc-reaches-devnet/`](../../probes/f08-anon-rpc-reaches-devnet/README.md),
  with the browser console log of the run.
- `@anon-rpc/browser-harness` 0.4.0 from npm; specifiers and gateway from
  https://github.com/ethereum/anon-rpc `adopters.json5` at `ae7e697a`.
