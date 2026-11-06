# F5. Can a CRE simulation write to chain 1337?

**Verdict:** open

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

## Evidence
