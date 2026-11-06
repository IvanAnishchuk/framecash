/**
 * The mint's decision for one deposit: split `mintable(amount)` over the ladder, sign one
 * blinded point per note with that denomination's key, and say which points it used.
 *
 * The CRE workflow (`workflow/`) runs the same rule in Go. The local mint in the CLI uses
 * this one when the CRE simulation cannot write to the devnet (F5).
 */

import { type Hex, toHex } from "viem";
import { fromHex } from "./bls/eip2537.ts";
import { type MintKey, blindSign } from "./bls/mint.ts";
import { mintable, split } from "./ladder.ts";

export interface Announcement {
  id: bigint;
  pointIndexes: bigint[];
  denoms: bigint[];
  blindSigs: Hex[];
}

/** Returns null when the deposit carries too few points for its split; refund it then. */
export function answer(id: bigint, amount: bigint, points: Hex[], keys: MintKey[], rung: bigint): Announcement | null {
  const notes = split(mintable(amount, rung), keys.map((k) => k.denom));
  if (notes.length > points.length) return null;
  const byDenom = new Map(keys.map((k) => [k.denom, k]));
  return {
    id,
    pointIndexes: notes.map((_, i) => BigInt(i)),
    denoms: notes,
    blindSigs: notes.map((d, i) => toHex(blindSign(byDenom.get(d)!, fromHex(points[i])))),
  };
}
