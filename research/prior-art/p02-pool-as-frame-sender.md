# P2. Privacy pools as the frame-tx sender, paying their own gas

**Verdict:** open

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

## Evidence
