# P2. Privacy pools as the frame-tx sender, paying their own gas

**Verdict:** done before, as a mechanism (2026-11-07). Differentiate: nobody we found
verifies a real credential in the pool's VERIFY frame. Only the sidecar repo was searched;
the ERC text, the ethresear.ch threads and Kohaku were not.

## What we need to know

Whether anyone has built or specified a pool that is itself `tx.sender` of a frame
transaction and pays gas from the withdrawn note. This is named in the ERC-8421
rationale ("shielded pools with Merkle roots as paymasters") and in research threads,
so the idea is known. The question is how far existing work goes, and how our
blind-signature variant differs from the Merkle/ZK variants.

## Where to look

- ERC-8421 and EIP-8141 rationale sections, and their discussion threads.
- ethresear.ch: "Frame transactions and the three gates to privacy", the validation
  budget for privacy applications thread, and the order-dependence thread.
- The alt-mempool sidecar repo's e2e tests for shared-sender pools.
- Kohaku and other EF privacy-wallet work.

## Findings

- Skandha's own e2e suite (https://github.com/forshtat/mempool-workshop-sidecar at
  `8ea2250a`, `test/e2e/sharedSenderPool.ts` and `frameTxSharedSender.e2e.test.ts`) has
  "a minimal shared-sender privacy pool stand-in". The pool is the sender and payer of
  every withdrawal, the nullifier is the withdrawal's nonce key at sequence 0, and the root
  is an EIP-8272 recent root the pool published. It shows two concurrent withdrawals from one
  sender admitted and included, and a replay refused with "Nonce mismatch".
- In its own words, "No ZK — the point is the mempool and protocol mechanics, not the
  proof". The VERIFY frame checks only that the key is non-zero and the root is the pool's.
  It authenticates neither the sequence nor a holder, so anyone could withdraw.
- framecash reuses the mechanism and adds what the stand-in leaves out:
  - a real credential, the mint's BLS signature checked by pairing in VERIFY (317k gas,
    F2);
  - the nullifier bound to the note, with key count, key value and sequence all checked.
    F3 showed that the sequence check is what stops a second spend;
  - the holder's signature over the canonical hash (F4), so nobody can redirect or reprice;
  - the frame list pinned, so a SENDER frame cannot move the pool's balance.
- Differentiation, for the README: blind signatures instead of a Merkle proof. There is no
  tree, no recent-root dependency and no circuit, the notes are bearer instruments, and the
  pool and Skandha's mechanics carry the rest.

## Evidence

- `sharedSenderPool.ts`, header comment and runtime, at the commit above.
