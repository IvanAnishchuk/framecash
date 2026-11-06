# F2. Does Skandha admit ~180k of validation gas for a staked sender?

**Verdict:** open

## Why it matters

One-note verification is estimated at ~178k gas (`docs/design.md` §4): over the
canonical 100k cap, under the 1M that ERC-8421 grants a staked entity. The EF workshop
only exercised the storage-read relaxation, never the per-entity gas budget.

**If it fails:** the pool can't pay its own gas, and payments need a relayer. That
removes the reason to use frame transactions at all.

## How to settle

- Stake a test sender in the Staking Registry, with a VERIFY frame that burns a set
  amount of gas: 90k, 150k, 250k, 900k.
- Submit each through the gateway and record which are admitted and which are rejected,
  with the error.
- Check that admitted txs are included, not just accepted.
- Read the Skandha source for where the per-entity budget is enforced, and pin the
  commit.

## Findings

## Evidence
