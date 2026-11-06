# F1. Is EIP-2537 live on the alt-mempool devnet?

**Verdict:** open

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

## Evidence
