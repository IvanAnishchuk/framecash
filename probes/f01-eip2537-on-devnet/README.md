# F1 probe: EIP-2537 on the devnet

Answers [`research/feasibility/f01-eip2537-on-devnet.md`](../../research/feasibility/f01-eip2537-on-devnet.md).

## What it checks

`eth_call` and `eth_estimateGas` on four BLS12-381 precompiles with known-answer inputs:
G1ADD and G2ADD of two points at infinity, a one-pair pairing of infinities (true), and
MAP_FP2_TO_G2 of zero. The contract uses G2ADD, PAIRING and MAP_FP2_TO_G2.

## Run

```sh
bash probe.sh      # needs cast; ETHREX_URL overrides the node
```

## Result, 2026-11-07: works

ethrex `v23.0.0-eip8141-tracer-9aa3645d`, chain 1337, `https://altmempool.forshtat.com`.

| Precompile | Output | `eth_estimateGas` (incl. 21k base + calldata) |
|---|---|---|
| `0x0b` G1ADD | 128 zero bytes (infinity) | 31,737 |
| `0x0d` G2ADD | 256 zero bytes (infinity) | 48,153 |
| `0x0f` PAIRING, 1 pair | `1` | 87,763 |
| `0x11` MAP_FP2_TO_G2(0) | `0x…018320896e…4c69777a…aadf5c`, a valid G2 point | 39,681 |

All four answer, and the outputs are the RFC values. The `*.altmempool.wtf` hosts named in
the design fail the TLS handshake from here (`unexpected eof while reading`); the live
devnet is the workshop's `altmempool.forshtat.com`.
