# P3. BLS12-381 verification and hash-to-G2 in Solidity after Pectra

**Verdict:** done before, by us: reused (2026-11-07). The BLS library and the RFC 9380
hash-to-G2 come from teecash, which took the conventions from nozkash. No third-party
library was searched for.

## What we need to know

An audited or widely used library for BLS signature verification on the EIP-2537
precompiles, including RFC 9380 hash-to-G2, with measured gas. Using one saves build
time and makes the ~50k hash-to-G2 estimate a measured number.

## Where to look

- GitHub: Solidity libraries using the `0x0b`–`0x11` precompiles; the EIP-2537 test
  vectors.
- Ethereum client and consensus-layer projects that verify BLS on-chain (light clients,
  bridges).
- Whether hashing to G1 instead of G2 (signatures in G1, keys in G2) is cheaper here.

## Findings

- `contracts/src/BLS.sol` is teecash's (https://github.com/IvanAnishchuk/teecash,
  `contracts/src/BLS.sol`). It has `expand_message_xmd` with SHA-256, two `MAP_FP2_TO_G2`
  calls, `G2ADD`, `MODEXP` for the reduction mod p, and the pairing check. The TypeScript
  side is teecash's `lib-blind`, and it agrees with the Solidity over FFI (`contracts/test`,
  dst and blind-path signatures).
- Measured on the devnet: the whole `validate` costs 317,451 gas (F2), against the
  design's 178k estimate. The byte-copy loops (`slice64` and friends) and calldata decoding
  are a known part of the gap. An assembly `mcopy` version would cut it, at the cost of
  touching verified code during the event. Not needed under the staked budget.
- Not searched: third-party audited libraries, and the G1-signature variant.

## Evidence

- `contracts/test/FramePool.t.sol` (`test_dstMatchesTypeScript`,
  `test_validateAcceptsOneNoteSpend`) and the F2 probe.
