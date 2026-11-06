/**
 * The denomination ladder and the mint's split. `FramePool.mintable` must agree.
 *
 * Powers of ten keep the ladder short: each rung is a BLS key the pool stores, and a
 * deposit of X mints at most 9 notes per rung. The smallest rung is the mint tax.
 */

export const ETH = 10n ** 18n;

/** 0.001, 0.01, 0.1 and 1 ETH. */
export const LADDER: readonly bigint[] = [ETH / 1000n, ETH / 100n, ETH / 10n, ETH];
export const RUNG = LADDER[0];

/** One rung plus everything below it is tax. Matches the contract. */
export function mintable(amount: bigint, rung: bigint = RUNG): bigint {
  if (amount < rung) return 0n;
  return (amount / rung - 1n) * rung;
}

/** The deposit that mints exactly `want` (a multiple of the rung). */
export function grossFor(want: bigint, rung: bigint = RUNG): bigint {
  if (want % rung !== 0n) throw new Error(`ladder: ${want} is not a multiple of the rung`);
  return want + rung;
}

/** Greedy split, largest rung first. Every amount the ladder can express splits exactly. */
export function split(amount: bigint, ladder: readonly bigint[] = LADDER): bigint[] {
  const out: bigint[] = [];
  let left = amount;
  for (const d of [...ladder].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))) {
    while (left >= d) {
      out.push(d);
      left -= d;
    }
  }
  if (left !== 0n) throw new Error(`ladder: ${amount} leaves ${left} below the rung`);
  return out;
}

/** Points a client should send so the mint can always split: the split plus slack. */
export function pointCount(amount: bigint, slack = 2): number {
  return split(mintable(amount)).length + slack;
}
