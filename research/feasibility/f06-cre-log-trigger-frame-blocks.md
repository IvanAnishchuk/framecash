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

Not run: blocked on the CRE login, as F5. Ready to run: the change deposit of the demo
payment is emitted inside frame tx `0xe1984cd46fe86328d09be6ef22dd55bd2aa526a89d5e5f2ab6c7f440973be9c0`
(block 10277), so `just cre-mint-once 0xe1984cd4…` with the right event index is exactly
this question.

What the local mint already shows: `eth_getLogs` returns the `Deposited` event from inside
the frame tx like any other log, and the local mint answered it (deposit 2 in the demo). So
the cron sweep fallback, which reads logs, works on these blocks.

## Evidence

- `probes/f02-staked-validation-budget/demo-2026-11-07.txt`: "deposit 2: announced …" is
  the change deposit from inside the frame tx.
