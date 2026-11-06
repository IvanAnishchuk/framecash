# F3. Are EIP-8250 single-use nonce keys live?

**Verdict:** open

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

## Evidence
