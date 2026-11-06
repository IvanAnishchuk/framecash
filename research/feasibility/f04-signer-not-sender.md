# F4. Can `self_verify` approve on a SECP256K1 signer that isn't `tx.sender`?

**Verdict:** open

## Why it matters

The note key `a` signs the canonical sig hash, and the pool reads the recovered signer
through `SIGPARAM`. That binds fees, frames and nonce keys to the note holder, so nobody
in the mempool can redirect a payment or inflate its fee.

**If it fails:** the note-key signature moves into frame data and is checked with
`ecrecover` over the sig hash read from `TXPARAM(0x08)`. That's cheap, but the binding
must be re-derived and checked against every field a front-runner could change.

## How to settle

- Read EIP-8141 for how signatures attach to a tx and whether the protocol validates a
  signer it doesn't match against the sender.
- Probe: a frame tx with `sender = pool` signed by an unrelated key, and a VERIFY frame
  that reads `SIGPARAM` and approves.

## Findings

## Evidence
