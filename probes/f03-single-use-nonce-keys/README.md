# F3 probe: single-use nonce keys

Answers [`research/feasibility/f03-single-use-nonce-keys.md`](../../research/feasibility/f03-single-use-nonce-keys.md).

## What it checks

With a sender that approves anything its owner signs (the F4 contract), it submits frame
txs on fresh nonce keys at each sequence form and replays them:

1. EIP-8250's single-use form, `nonce_seq = MAX_NONCE_SEQ = 2^64-1`, then a replay.
2. `2^64-2`, which Skandha's types call `MAX_NONCE_SEQ`.
3. Sequential use: seq 0, a replay at seq 0, then the same key at seq 1.

After each inclusion it reads the key's `NONCE_MANAGER` slot, `keccak256(pad(sender) ‖ pad(key))`.

## Run

```sh
npm install
npm run probe     # builds ../f04-signer-not-sender, then node probe.ts
```

Keys are fresh throwaway devnet keys each run, funded from the devnet's shared genesis key.

## Result, 2026-11-07: single-use form fails; sequential works with a pool-side check

ethrex `v23.0.0-eip8141-tracer-9aa3645d`, Skandha `v4.1.1`, chain 1337.

```
probe 0xe1269bab7ca9149c643560dff58a29467733a55b
REJECTED single-use seq 2^64-1: -32602 nonceSeq must be < 2**64 - 1
REJECTED replay single-use seq 2^64-1: -32602 nonceSeq must be < 2**64 - 1
MINED    same key at seq 0: 0x214f9fb8…57ae5f status 0x1, NONCE_MANAGER slot = 1
REJECTED seq 2^64-2: -32500 Invalid Transaction: Nonce mismatch: expected 0, got 18446744073709551614
REJECTED replay seq 2^64-2: -32500 Invalid Transaction: Nonce mismatch: expected 0, got 18446744073709551614
MINED    sequential seq 0: 0x0177029456623074d71ae2b6535439f062b1fd6bc109a6bab66aafad5cb96683 status 0x1, NONCE_MANAGER slot = 1
REJECTED replay sequential seq 0: -32500 Invalid Transaction: Nonce mismatch: expected 1, got 0
MINED    same key at seq 1: 0x36493cc8b6d01a088c8f9f94c4ff72c9f795431f7d2e00993b67e30e657d29ff status 0x1, NONCE_MANAGER slot = 2
```

- Skandha rejects `2^64-1` at parameter validation, and ethrex treats `2^64-2` as an
  ordinary sequence. The single-use form of the current EIP-8250 text is not live here.
- A sequential key at seq 0 is consumed (slot 0 → 1) and a replay at 0 is refused. **But the
  same key at seq 1 is mined**: the protocol alone does not make a key single-use.

Also found: for an unstaked sender Skandha charges the VERIFY frame's *limit* plus 2,800
signature gas against `MAX_VERIFY_GAS` (`prefix gas budget exceeded: 102800 > 100000`), so
an unstaked VERIFY limit must stay at or under 97,200. A first run with a 100k limit hit
that; this run uses 90k. It also showed ethrex returning a receipt before Skandha drops the
tx from its pending set, so the probe waits 15 s after each inclusion.
