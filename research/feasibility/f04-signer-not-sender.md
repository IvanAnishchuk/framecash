# F4. Can `self_verify` approve on a SECP256K1 signer that isn't `tx.sender`?

**Verdict:** works (probe, 2026-11-07)

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

- EIP-8141 §Transaction Signatures: for SECP256K1 "the `signer` is a 20-byte Ethereum
  address. If absent, `tx.sender` is used". The protocol checks
  `resolved_signer == ecrecover(msg, v, r, s)` before any frame runs, and never compares
  the signer with the sender. `SIGPARAM(0x00)` returns `resolved_signer`.
- Shown live: a contract that is `tx.sender` approved a tx signed only by an unrelated
  key, after checking `SIGPARAM` returned that key. Skandha admitted it and ethrex mined it,
  with both frames successful and the contract as payer.
- Stock Solidity reaches the new opcodes through raw-bytecode helpers: `APPROVE` by
  delegatecall (it must run as the sender), `TXPARAM` and `SIGPARAM` by staticcall. No
  compiler change is needed. The EF workshop uses the same pattern
  (https://github.com/forshtat/mempool-workshop at `902673eb`, `docs/findings.md`).
- `TXPARAM` returned the right `nonce_seq` (0x01), key count (0x0E), key 0 (0x10) and sig
  hash (0x08), so the pool can authenticate its nullifier key as EIP-8250 requires.

The design keeps the note key in the protocol-verified signature entry, as drafted.

## Evidence

- Probe: [`probes/f04-signer-not-sender/`](../../probes/f04-signer-not-sender/README.md)
- Tx `0x8ad3590b2f5bb5ae19714a1afeeb870a2b52ec7c26fbd1a43abf6f60b3428bde`, block 10041,
  chain 1337, on ethrex `v23.0.0-eip8141-tracer-9aa3645d` and Skandha `v4.1.1`.
