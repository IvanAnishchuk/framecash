# F3. Are EIP-8250 single-use nonce keys live?

**Verdict:** fails (probe, 2026-11-07). The single-use form is not live. The design takes a
better fallback than `spent[]`: a sequential key at seq 0, which the pool alone accepts.

## Why it matters

The design uses `nonce_keys = [H("note" ‖ pool ‖ d ‖ A)]` with
`nonce_seq = MAX_NONCE_SEQ` as the nullifier: the protocol itself marks the note spent,
and no storage read is needed in validation.

**If it fails:** the pool keeps a `spent[]` mapping in its own storage. Reads of the
sender's own storage are allowed, but every payment's write could force revalidation of
the other pending payments. That may cap concurrency and should be measured.

## How to settle

- Send a frame tx with a single-use key on the devnet, then try to replay the same key.
- Confirm `TXPARAM` exposes the key count and keys hash, which the VERIFY frame must
  authenticate.
- Read the nonce manager's storage layout, which the client needs for "is my note
  spent?".
- If the fallback is needed: run 10 pending payments against one pool and see whether
  one inclusion evicts the rest.

## Findings

- `nonce_seq = 2^64-1` (EIP-8250's `MAX_NONCE_SEQ`): Skandha rejects it at parameter
  validation, `-32602 nonceSeq must be < 2**64 - 1`. Its types still define
  `MAX_NONCE_SEQ = 2^64-2`, an older draft. ethrex treats `2^64-2` as an ordinary sequence
  (`Nonce mismatch: expected 0`). So the single-use form is not available on this devnet.
- Sequential keys work as EIP-8250 describes: seq 0 consumes the key (`NONCE_MANAGER` slot
  0 → 1) and a replay at seq 0 is refused with `Nonce mismatch: expected 1, got 0`.
- **The same key at seq 1 was then mined.** A sequential key is not single-use by itself.
- `TXPARAM(0x01)`, `(0x0E)` and `(0x10)` return the sequence, key count and key 0 inside the
  tx (shown in the F4 probe), so the pool can authenticate all three.
- `NONCE_MANAGER` layout confirmed: slot `keccak256(pad32(sender) ‖ pad32(key))` holds the
  next sequence. A client reads it to see whether a note is spent.

**What the design takes.** Each payment uses `nonce_keys = [noteKey(d, A)]` and
`nonce_seq = 0`, and `FramePool.validate` rejects any other count, key or sequence. The
protocol consumes the key at payment approval, and after that no sequence the pool accepts
can use it again. This keeps the original property: validation reads no storage a payment
writes, so no `spent[]` mapping and no revalidation storm. `FramePool.noteSeq` is an
immutable, so a pool deployed after the single-use form lands can set `2^64-1` instead.

The 10-pending-payments concurrency test is moot, since the fallback has no shared slot.
Concurrent keyed txs on one sender were shown in Skandha's own e2e test (see P2).

## Evidence

- Probe: [`probes/f03-single-use-nonce-keys/`](../../probes/f03-single-use-nonce-keys/README.md),
  on ethrex `v23.0.0-eip8141-tracer-9aa3645d` and Skandha `v4.1.1`, chain 1337.
- Mined: `0x0177029456623074d71ae2b6535439f062b1fd6bc109a6bab66aafad5cb96683` (seq 0),
  `0x36493cc8b6d01a088c8f9f94c4ff72c9f795431f7d2e00993b67e30e657d29ff` (same key, seq 1).
- EIP-8250 text: `research/sources` capture pending; the spec text read was the copy in the
  hackathon notes, `TXPARAM_NONCE_KEY_COUNT 0x0E`, `TXPARAM_NONCE_KEY_0 0x10`,
  `MAX_NONCE_SEQ 2**64 - 1`.
