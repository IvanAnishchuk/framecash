# F6. Does the CRE log trigger work on blocks with type-`0x06` txs?

**Verdict:** open

## Why it matters

The mint fires on the pool's `Deposit` event, and change deposits are emitted inside
frame transactions. If the trigger's block or receipt decoding chokes on the new tx
type, the mint misses deposits.

**If it fails:** change deposits can't be minted through the trigger. Workarounds: a
cron trigger that reads logs with `eth_getLogs`, or emitting change deposits from a
separate plain tx.

## How to settle

- Simulate a workflow with a log trigger on the devnet while frame txs land in the same
  blocks, and confirm events from inside a frame tx are delivered.

## Findings

## Evidence
