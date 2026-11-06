# F8. Can Anon-RPC's tor-js or Nym routes reach the `altmempool.wtf` hosts?

**Verdict:** open

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

## Evidence
