/**
 * The wallet: deposit planning, sync from chain, spent checks and payments.
 *
 * Every chain access goes through an `Rpc`, which wraps a caller-supplied `fetch`. The
 * browser app passes Anon-RPC's `worker.fetch`, the CLI passes the global one. Nothing here
 * opens a connection of its own.
 */

import { type Hex, concat, decodeEventLog, encodeFunctionData, keccak256, pad, toHex } from "viem";
import { unblind } from "./bls/blind.ts";
import type { Domain } from "./bls/domain.ts";
import { fromHex } from "./bls/eip2537.ts";
import { verify } from "./bls/verify.ts";
import { type FrameTx, toWire, txHash } from "./frametx.ts";
import { LADDER, mintable, pointCount, split } from "./ladder.ts";
import { blindedPoint, noteSecret, rBytes } from "./notes.ts";
import { POOL_ABI, buildPayment, maxCostBound, noteKey } from "./pool.ts";

export type Rpc = ((method: string, params?: unknown[]) => Promise<any>) & {
  /** Many calls in one HTTP request (JSON-RPC batch). Over a mixnet one round trip is seconds. */
  batch?: (calls: [string, unknown[]][]) => Promise<any[]>;
};
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class RpcError extends Error {
  method: string;
  code: number;
  constructor(method: string, code: number, message: string) {
    super(`${method}: ${code} ${message}`);
    this.method = method;
    this.code = code;
  }
}

/** JSON-RPC over `fetchFn`. `onCall` sees every method name, for the app's route display. */
export function httpRpc(url: string, fetchFn: FetchLike = fetch, onCall?: (method: string) => void): Rpc {
  let id = 0;
  const post = async (payload: unknown) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  };
  const rpc: Rpc = async (method, params = []) => {
    onCall?.(method);
    const body = await post({ jsonrpc: "2.0", id: ++id, method, params });
    if (body.error) throw new RpcError(method, body.error.code, body.error.message);
    return body.result;
  };
  rpc.batch = async (calls) => {
    if (calls.length === 0) return [];
    for (const [m] of calls) onCall?.(m);
    const first = id + 1;
    const body: any[] = await post(calls.map(([method, params]) => ({ jsonrpc: "2.0", id: ++id, method, params })));
    const byId = new Map(body.map((r) => [r.id, r]));
    return calls.map(([method], i) => {
      const r = byId.get(first + i);
      if (!r || r.error) throw new RpcError(method, r?.error?.code ?? -1, r?.error?.message ?? "missing from batch reply");
      return r.result;
    });
  };
  return rpc;
}

/** The ethrex node (reads, ordinary txs) and the Skandha alt-mempool (frame txs). */
export interface Chain {
  node: Rpc;
  mempool: Rpc;
}

export const NONCE_MANAGER = "0x0000000000000000000000000000000000008250" as Hex;

// ---------------------------------------------------------------------------------------
// Wallet state. The seed is the only secret; everything else can be rebuilt from chain.
// ---------------------------------------------------------------------------------------

export interface Note {
  index: number;
  address: Hex;
  denom: string; // wei, as a decimal string so the state is plain JSON
  sig: Hex;
  depositId: string;
  spent: boolean;
}

export interface Wallet {
  seed: Hex;
  /** The next unused counter. */
  next: number;
  notes: Note[];
  /** Last block sync has scanned (decimal). Absent: scan from the pool's deployment. */
  cursor?: string;
  /** Our deposits the mint has not answered yet: deposit id -> counter per point index. */
  waiting?: Record<string, (number | null)[]>;
}

export interface PoolInfo {
  address: Hex;
  chainId: number;
  noteSeq: bigint;
  rung: bigint;
  pubkeys: Map<string, Uint8Array>; // denom (wei string) -> G1 key
  fromBlock: bigint;
}

export async function readPool(rpc: Rpc, address: Hex, fromBlock = 0n): Promise<PoolInfo> {
  const ethCall = (fn: string, args: unknown[] = []): [string, unknown[]] => [
    "eth_call",
    [{ to: address, data: encodeFunctionData({ abi: POOL_ABI, functionName: fn as never, args: args as never }) }, "latest"],
  ];
  const calls: [string, unknown[]][] = [["eth_chainId", []], ethCall("noteSeq"), ethCall("rung"), ...LADDER.map((d) => ethCall("mintPubkeys", [d]))];
  // One round trip when the transport batches; seven otherwise.
  const out = rpc.batch ? await rpc.batch(calls) : await Promise.all(calls.map(([m, p]) => rpc(m, p)));
  const chainId = Number(out[0]);
  const noteSeq = BigInt(out[1]);
  const rung = BigInt(out[2]);
  const pubkeys = new Map<string, Uint8Array>();
  for (const [i, d] of LADDER.entries()) {
    const raw: Hex = out[3 + i];
    // ABI-encoded `bytes`: offset, length, data.
    const len = Number(BigInt(`0x${raw.slice(66, 130)}`));
    if (len === 128) pubkeys.set(d.toString(), fromHex(`0x${raw.slice(130, 130 + 256)}`));
  }
  return { address, chainId, noteSeq, rung, pubkeys, fromBlock };
}

export const domainOf = (p: PoolInfo): Domain => ({ chainId: p.chainId, contract: p.address });

// ---------------------------------------------------------------------------------------
// Add money.
// ---------------------------------------------------------------------------------------

/** Blinded points for a deposit of `amount`: the split plus slack, from fresh counters. */
export function planDeposit(wallet: Wallet, pool: PoolInfo, amount: bigint): Hex[] {
  const n = pointCount(amount);
  const points: Hex[] = [];
  for (let i = 0; i < n; i++) points.push(blindedPoint(wallet.seed, wallet.next + i, domainOf(pool)).blinded);
  wallet.next += n;
  return points;
}

export function depositCalldata(points: Hex[]): Hex {
  return encodeFunctionData({ abi: POOL_ABI, functionName: "deposit", args: [points] });
}

// ---------------------------------------------------------------------------------------
// Sync: find our deposits by their blinded points, unblind what the mint announced.
// ---------------------------------------------------------------------------------------

/**
 * Blocks per eth_getLogs call. Every deposit and announcement carries 256-byte points, and
 * over a mixnet a big reply outlives the worker's per-call timeout (25 s on Nox), so ranges
 * go in chunks, and a chunk that fails is split in half.
 */
const LOG_CHUNK = 256n;

async function logs(rpc: Rpc, pool: PoolInfo, event: string, from: bigint, to: bigint): Promise<any[]> {
  const ev = POOL_ABI.find((x) => x.type === "event" && x.name === event) as any;
  const topic = keccak256(toHex(`${event}(${ev.inputs.map((i: any) => i.type).join(",")})`));
  const range = async (a: bigint, b: bigint): Promise<any[]> => {
    try {
      return await rpc("eth_getLogs", [{ address: pool.address, topics: [topic], fromBlock: toHex(a), toBlock: toHex(b) }]);
    } catch (e) {
      if (b - a < 4n) throw e;
      const mid = (a + b) / 2n;
      return [...(await range(a, mid)), ...(await range(mid + 1n, b))];
    }
  };
  const raw: any[] = [];
  for (let a = from; a <= to; a += LOG_CHUNK) raw.push(...(await range(a, a + LOG_CHUNK - 1n < to ? a + LOG_CHUNK - 1n : to)));
  return raw.map((l: any) => ({ ...decodeEventLog({ abi: POOL_ABI, data: l.data, topics: l.topics }).args, log: l }));
}

/** How far past the last known counter recovery looks. */
export const GAP = 32;

/**
 * Bring the note list up to date. Incremental: only blocks after `wallet.cursor` are read,
 * and deposits still waiting for the mint are remembered in `wallet.waiting`. A wallet with
 * no cursor (a restore) scans from the pool's deployment, matching every counter up to
 * `next + GAP` against the deposits' blinded points, so the seed alone is enough.
 */
export async function sync(rpc: Rpc, pool: PoolInfo, wallet: Wallet): Promise<{ added: Note[]; pending: number }> {
  const head = BigInt(await rpc("eth_blockNumber"));
  const from = wallet.cursor ? BigInt(wallet.cursor) + 1n : pool.fromBlock;
  const waiting = (wallet.waiting ??= {});
  const deposited = from <= head ? await logs(rpc, pool, "Deposited", from, head) : [];
  const announced = from <= head ? await logs(rpc, pool, "Announced", from, head) : [];

  // Deriving a blinded point is a hash-to-curve and a scalar multiplication. Keep them for
  // the session, so each sync only derives counters it hasn't seen.
  const cacheKey = `${wallet.seed}|${pool.chainId}|${pool.address.toLowerCase()}`;
  const points = derived.get(cacheKey) ?? new Map<string, number>();
  derived.set(cacheKey, points);
  let horizon = wallet.next + GAP;
  const derive = (upTo: number) => {
    for (let i = points.size; i < upTo; i++) points.set(blindedPoint(wallet.seed, i, domainOf(pool)).blinded.toLowerCase(), i);
  };
  derive(horizon);

  // Our deposits in the new range join the waiting list.
  for (const d of deposited) {
    const ours = (d.blindedPoints as Hex[]).map((p) => points.get(p.toLowerCase()) ?? null);
    if (ours.every((i) => i === null)) continue;
    const top = Math.max(...ours.filter((i): i is number => i !== null));
    if (top + 1 > wallet.next) wallet.next = top + 1;
    if (wallet.next + GAP > horizon) derive((horizon = wallet.next + GAP));
    waiting[d.id.toString()] = ours;
  }

  // Announcements for waiting deposits become notes.
  const known = new Set(wallet.notes.map((n) => n.address.toLowerCase()));
  const added: Note[] = [];
  for (const a of announced) {
    const id = a.id.toString();
    const ours = waiting[id];
    if (!ours) continue;
    for (let k = 0; k < a.pointIndexes.length; k++) {
      const index = ours[Number(a.pointIndexes[k])];
      if (index === null || index === undefined) continue;
      const secret = noteSecret(wallet.seed, index);
      if (known.has(secret.address.toLowerCase())) continue;
      const denom = a.denoms[k] as bigint;
      const sig = unblind(fromHex(a.blindSigs[k]), rBytes(secret.r));
      const pk = pool.pubkeys.get(denom.toString());
      if (!pk || !verify(pk, secret.address, sig, domainOf(pool))) throw new Error(`sync: mint signature for note ${index} does not verify`);
      const note: Note = { index, address: secret.address, denom: denom.toString(), sig: toHex(sig), depositId: id, spent: false };
      wallet.notes.push(note);
      known.add(secret.address.toLowerCase());
      added.push(note);
    }
    delete waiting[id];
  }
  wallet.cursor = head.toString();
  await markSpent(rpc, pool, wallet.notes.filter((n) => !n.spent));
  return { added, pending: Object.keys(waiting).length };
}

const derived = new Map<string, Map<string, number>>();

function spentSlot(pool: PoolInfo, note: Note): Hex {
  const key = noteKey(pool.chainId, pool.address, BigInt(note.denom), note.address);
  return keccak256(concat([pad(pool.address), pad(toHex(key))]));
}

/** A note is spent once its nonce key has left sequence 0 in NONCE_MANAGER. */
export async function isSpent(rpc: Rpc, pool: PoolInfo, note: Note): Promise<boolean> {
  return BigInt(await rpc("eth_getStorageAt", [NONCE_MANAGER, spentSlot(pool, note), "latest"])) !== 0n;
}

/** Check many notes in one batched request when the transport supports it. */
async function markSpent(rpc: Rpc, pool: PoolInfo, notes: Note[]): Promise<void> {
  if (notes.length === 0) return;
  if (rpc.batch) {
    const out = await rpc.batch(notes.map((n) => ["eth_getStorageAt", [NONCE_MANAGER, spentSlot(pool, n), "latest"]]));
    notes.forEach((n, i) => (n.spent = BigInt(out[i]) !== 0n));
    return;
  }
  for (const n of notes) n.spent = await isSpent(rpc, pool, n);
}

export const balance = (w: Wallet): bigint => w.notes.filter((n) => !n.spent).reduce((s, n) => s + BigInt(n.denom), 0n);

// ---------------------------------------------------------------------------------------
// Pay.
// ---------------------------------------------------------------------------------------

/**
 * Max fee per gas: twice the base fee plus a fixed tip. Not eth_gasPrice: on the shared
 * devnet it follows other users' tips (1.7 gwei against a 7 wei base fee on 2026-11-07),
 * and the pool reserves maxFee × all frame limits from the note, so a 0.01 note could no
 * longer pay 0.004. Payments at 2–7 million wei per gas were all included.
 */
export async function feeNow(rpc: Rpc): Promise<bigint> {
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const base = BigInt(block?.baseFeePerGas ?? 0);
  return base * 2n + 5_000_000n;
}

export interface Payment {
  tx: FrameTx;
  hash: Hex;
  note: Note;
  changeIndexes: number[];
}

/**
 * Pay `amount` to `payee` from the smallest unspent note that covers it plus gas. The rest
 * comes back as change: fresh blinded points the mint signs after the payment lands.
 */
export async function preparePayment(pool: PoolInfo, wallet: Wallet, payee: Hex, amount: bigint, maxFeePerGas: bigint): Promise<Payment> {
  const gas = maxCostBound(maxFeePerGas);
  const note = wallet.notes
    .filter((n) => !n.spent && BigInt(n.denom) >= amount + gas)
    .sort((a, b) => (BigInt(a.denom) < BigInt(b.denom) ? -1 : 1))[0];
  if (!note) throw new Error(`pay: no single note covers ${amount} plus gas (multi-note payments are a stretch goal)`);

  // The exact change is denom - amount - TXPARAM(0x06), so at least `denom - amount - gas`.
  // Points for that split plus slack; a change too small to mint stays in the pool.
  const changeMint = mintable(BigInt(note.denom) - amount - gas, pool.rung);
  const changeIndexes: number[] = [];
  const changeBlinds: Hex[] = [];
  if (changeMint > 0n) {
    const n = split(changeMint).length + 2;
    for (let i = 0; i < n; i++) {
      const { blinded } = blindedPoint(wallet.seed, wallet.next, domainOf(pool));
      changeIndexes.push(wallet.next++);
      changeBlinds.push(blinded);
    }
  }
  const secret = noteSecret(wallet.seed, note.index);
  const tx = await buildPayment({
    chainId: pool.chainId,
    pool: pool.address,
    note: { key: secret.key, address: note.address, denom: BigInt(note.denom), sig: note.sig },
    payee,
    amount,
    changeBlinds,
    noteSeq: pool.noteSeq,
    maxFeePerGas,
  });
  return { tx, hash: txHash(tx), note, changeIndexes };
}

/** Submit to the alt mempool. Returns the hash Skandha reports. */
export async function submitPayment(chain: Chain, p: Payment): Promise<Hex> {
  return chain.mempool("eth_sendFrameTransaction", [toWire(p.tx)]);
}

/**
 * Wait for a frame tx through Skandha's own status, then read the receipt. Skandha can admit
 * a tx and later drop it ("relayed 4 times without being included in a block"); a receipt
 * poll alone would wait out its timeout without saying so.
 */
export async function waitPayment(chain: Chain, hash: Hex, timeoutMs = 180_000): Promise<any> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = await chain.mempool("skandha_frameTransactionStatus", [hash]);
    if (s?.status === "OnChain") return waitReceipt(chain.node, hash);
    if (s?.status === "Cancelled") throw new Error(`Skandha dropped ${hash}: ${s.reason ?? "no reason given"}. The note is unspent; pay again.`);
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`${hash} not included within ${timeoutMs / 1000} s`);
}

export async function waitReceipt(rpc: Rpc, hash: Hex, timeoutMs = 180_000): Promise<any> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`${hash} not mined within ${timeoutMs / 1000} s`);
}
