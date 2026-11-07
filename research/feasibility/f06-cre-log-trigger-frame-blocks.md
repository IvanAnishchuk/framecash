# F6. Does the CRE log trigger work on blocks with type-`0x06` txs?

**Verdict:** works (probe, 2026-11-07).

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

- Replay mode: `cre workflow simulate --evm-tx-hash <frame tx> --evm-event-index 1` fetched
  the receipt of payment `0x134935cb…6545` (type `0x06`). It decoded the change `Deposited`
  log from inside it, signed the four change notes in the confidential handler ("signed 4
  notes for deposit 2"), and wrote them. No local mint was running, and the wallet then
  synced the four notes.
- In that receipt the change deposit is log 1, after the payout's EIP-7708 transfer log (0)
  and before `Spent` (2).
- Live mode (`--listen`, which `just cre-mint` uses): the listening mint subscribed from
  block 10770. Payment `0x9bc3d4b21182515fb17001623d7c5e4337a8e9b921f5259db47c068d87f23258`
  landed in block 10784, the trigger fired on its change `Deposited` on its own ("signed 5
  notes for deposit 3"), and the report write `0x4a84b5f372514d608347a4abd4b22b0da74ef9ddc882df925bd1cd484c7d622b`
  (block 10785) followed. The wallet synced the five notes.

## Evidence

- Probe: [`probes/f05-cre-write-to-1337/`](../../probes/f05-cre-write-to-1337/README.md)
  (`simulate-change-in-frame-tx-2026-11-07.txt`).
- Report write `0xd25ab340e8e3f5ff3c57042713ab0ee0ff588d298841f3af4d50d98072e274e5`, block
  10750, chain 1337.
