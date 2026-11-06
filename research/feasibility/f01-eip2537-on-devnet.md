# F1. Is EIP-2537 live on the alt-mempool devnet?

**Verdict:** works (probe, 2026-11-07)

## Why it matters

The pool verifies the mint's BLS12-381 signature in its VERIFY frame. Without the
precompiles (`0x0b`–`0x11`), on-chain BLS verification is out of the gas budget.

**If it fails:** the project can't run on the devnet. There is no cheaper fallback.

## How to settle

- Call each precompile on `devnet{1,2,3}.altmempool.wtf` with a known-answer vector:
  pairing of 2 pairs, `MAP_FP2_TO_G2`, `G2ADD`.
- Measure the gas each call charges and compare against the EIP-2537 schedule.
- Record the client name and version from `web3_clientVersion`.

## Findings

- G1ADD, G2ADD, PAIRING and MAP_FP2_TO_G2 all answer with the expected outputs on ethrex
  `v23.0.0-eip8141-tracer-9aa3645d`, chain 1337.
- Gas with the 21k base: pairing of one pair 87,763 and MAP_FP2_TO_G2 39,681. That is
  consistent with the EIP-2537 schedule (pairing `32,600·k + 37,700`, map 23,800) plus
  base and calldata.
- The full pool verification also ran in forge's EVM (Prague) against the same precompile
  set: `validate` cost 454k there with mocked frame helpers (see `contracts/test`). The
  devnet figure is in F2.
- The design's `devnet{1,2,3}.altmempool.wtf` hosts did not answer (TLS EOF). The live
  devnet is `https://altmempool.forshtat.com` (ethrex) and `/rpc` (Skandha), from the
  workshop repo https://github.com/forshtat/mempool-workshop at `902673eb`.

## Evidence

- Probe: [`probes/f01-eip2537-on-devnet/`](../../probes/f01-eip2537-on-devnet/README.md)
