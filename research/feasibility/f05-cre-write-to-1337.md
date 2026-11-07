# F5. Can a CRE simulation write to chain 1337?

**Verdict:** works (probe, 2026-11-07), with our own forwarder on the chain.

## Why it matters

The mint delivers `announce` through `WriteReport`. In simulation, writes go through a
mock forwarder deployed per chain. Chain 1337 is in chain-selectors as `geth-testnet`
(selector `3379446385462418246`), and `--allow-unknown-chains` skips the name check, but
no mock forwarder is known for 1337.

**If it fails:** the workflow signs, and a small sidecar submits `announce` with a plain
key. Whether that still counts as the workflow being "meaningfully used" for the
Chainlink prize needs an answer from Chainlink; if not, the track drops.

## How to settle

- Read the CRE CLI source for how simulation resolves the forwarder address per chain,
  and whether a config override exists.
- Deploy the mock forwarder ourselves on the devnet if its bytecode is public, and point
  the simulation at it.
- Run `cre workflow simulate` against the devnet with a trivial write.
- Ask in the Chainlink hackathon channel whether a sidecar-submitted write qualifies.

## Findings

- The override exists. CRE CLI v1.32.0 has an `experimental-chains` target section with
  `chain-type`, `chain-selector`, `rpc-url` and `forwarder` (from the binary's settings
  structs; `--help` doesn't document it). An ordinary `rpcs:` entry for chain 1337 is
  dropped with "no RPC URLs found for target", by name or by selector.
- The forwarder is ours: `contracts/src/DevnetForwarder.sol`. It has Keystone's `report`
  entry point and metadata split, and checks no signatures, like the mock. Copying the real
  `MockKeystoneForwarder 1.0.0` runtime from Sepolia would not work, because its owner and
  forwarder allowlist live in storage the constructor writes.
- With that, `cre workflow simulate --broadcast` on a devnet deposit signed in the
  confidential handler and wrote the announcement through the forwarder. The pool accepted
  it, and the wallet unblinded and verified all five notes.
- The CLI reads `project.yaml` from the working directory and not from `-R`.

No sidecar is needed: the workflow's own `WriteReport` lands the announcement, so the
"meaningfully used" question no longer depends on one. F7, the external-system leg, is
separate.

Trust, stated in the README: the DevnetForwarder accepts a report from anyone, as the
simulator's mock does. A real deployment needs CRE to support the chain with its signed
forwarder.

## Evidence

- Probe: [`probes/f05-cre-write-to-1337/`](../../probes/f05-cre-write-to-1337/README.md),
  with the simulation output.
- Report write `0x582972cface2bc936e1b09489cd46dc837ab57620ca0fa371f1c4d9e9be73668`, block
  10730, chain 1337. Pool `0x27c0e726879c4703d6cef2da49db818ba0abd007`, forwarder
  `0x88e93b8df54523b7d45807ec592c99cf6c576ec8`.
