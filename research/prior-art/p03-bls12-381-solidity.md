# P3. BLS12-381 verification and hash-to-G2 in Solidity after Pectra

**Verdict:** open

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

## Evidence
