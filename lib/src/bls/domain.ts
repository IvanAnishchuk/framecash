/**
 * Domain separation tag for hash-to-curve. From teecash's lib-blind, with this project's tag.
 *
 * The tag holds the chain ID and the pool address, so a signature made for one pool fails
 * the pairing check at every other one. `FramePool._buildDst` builds the same bytes.
 */

export interface Domain {
  chainId: number;
  contract: string; // the pool, 20-byte hex with "0x"
}

const SUITE = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_";

export function dst(d: Domain): Uint8Array {
  const addr = d.contract.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new Error(`domain: bad contract address ${d.contract}`);
  if (!Number.isSafeInteger(d.chainId) || d.chainId <= 0) throw new Error(`domain: bad chainId ${d.chainId}`);
  const bytes = new TextEncoder().encode(`FRAMECASH_V1_${d.chainId}_${addr}_${SUITE}`);
  if (bytes.length > 255) throw new Error("domain: tag is longer than 255 bytes");
  return bytes;
}
