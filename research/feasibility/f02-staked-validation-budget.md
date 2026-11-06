# F2. Does Skandha admit ~180k of validation gas for a staked sender?

**Verdict:** works (probe, 2026-11-07): a staked pool's 317k VERIFY frame was admitted and
included.

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

- The real one-note payment, with `FramePool.validate` as the VERIFY frame, used **317,451**
  execution gas. That is more than the design's 178k estimate. The extra comes from about
  17 helper calls, ABI-decoding ~2 KB of frame data, cold reads of the stored key and DST,
  and the byte-copy loops in the BLS code from teecash. Skandha admitted it and ethrex
  included it, with the staked pool as sender and payer.
- For an unstaked sender, Skandha charges the VERIFY frame's *limit* plus signature gas
  against `MAX_VERIFY_GAS` = 100,000 (`prefix gas budget exceeded: 102800 > 100000`, seen
  in the F3 probe). So the staked relaxation is what admits the pool.
- Self-staking from the constructor works: the registry keys the stake on `msg.sender`,
  and the pool calls `addStake` itself (0.012 ETH; the registry's `minStake` is 0.01).
- Not measured: the staked ceiling itself. ERC-8421's text says 1M per entity; the burner
  ladder was skipped because the design's payload already passed with a 600k limit.
  Multi-note aggregation (~880k estimated, more now given the overhead above) would need
  that ceiling probed first.

Cost: the overhead above 178k is gas spent at 2,000,000 wei per gas on the devnet. The
measured frames are the input for the README's gas table.

## Evidence

- Probe: [`probes/f02-staked-validation-budget/`](../../probes/f02-staked-validation-budget/README.md),
  with the demo output and Skandha's admission record.
- Payment `0xe1984cd46fe86328d09be6ef22dd55bd2aa526a89d5e5f2ab6c7f440973be9c0`, block 10277,
  chain 1337, on ethrex `v23.0.0-eip8141-tracer-9aa3645d` and Skandha `v4.1.1`.
