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

export type Rpc = (method: string, params?: unknown[]) => Promise<any>;
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
  return async (method, params = []) => {
    onCall?.(method);
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new RpcError(method, body.error.code, body.error.message);
    return body.result;
  };
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
}

export interface PoolInfo {
  address: Hex;
  chainId: number;
  noteSeq: bigint;
  rung: bigint;
  pubkeys: Map<string, Uint8Array>; // denom (wei string) -> G1 key
  fromBlock: bigint;
}

const call = async (rpc: Rpc, to: Hex, fn: string, args: unknown[] = []): Promise<Hex> =>
  rpc("eth_call", [{ to, data: encodeFunctionData({ abi: POOL_ABI, functionName: fn as never, args: args as never }) }, "latest"]);

export async function readPool(rpc: Rpc, address: Hex, fromBlock = 0n): Promise<PoolInfo> {
  const chainId = Number(await rpc("eth_chainId"));
  const noteSeq = BigInt(await call(rpc, address, "noteSeq"));
  const rung = BigInt(await call(rpc, address, "rung"));
  const pubkeys = new Map<string, Uint8Array>();
  for (const d of LADDER) {
    const raw = await call(rpc, address, "mintPubkeys", [d]);
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

async function logs(rpc: Rpc, pool: PoolInfo, event: string): Promise<any[]> {
  const ev = POOL_ABI.find((x) => x.type === "event" && x.name === event) as any;
  const sig = `${event}(${ev.inputs.map((i: any) => i.type).join(",")})`;
  const raw = await rpc("eth_getLogs", [
    { address: pool.address, topics: [keccak256(toHex(sig))], fromBlock: toHex(pool.fromBlock), toBlock: "latest" },
  ]);
  return raw.map((l: any) => ({ ...decodeEventLog({ abi: POOL_ABI, data: l.data, topics: l.topics }).args, log: l }));
}

/** How far past the last known counter recovery looks. */
export const GAP = 32;

/**
 * Rebuild the note list from the chain. Works from the seed alone: every counter up to
 * `next + GAP` is re-derived and matched against the deposits' blinded points.
 */
export async function sync(rpc: Rpc, pool: PoolInfo, wallet: Wallet): Promise<{ added: Note[]; pending: number }> {
  const deposited = await logs(rpc, pool, "Deposited");
  const announced = new Map<string, any>();
  for (const a of await logs(rpc, pool, "Announced")) announced.set(a.id.toString(), a);

  const mine = new Map<string, number>();
  let horizon = wallet.next + GAP;
  const derive = (upTo: number) => {
    for (let i = mine.size; i < upTo; i++) mine.set(blindedPoint(wallet.seed, i, domainOf(pool)).blinded.toLowerCase(), i);
  };
  derive(horizon);

  const known = new Set(wallet.notes.map((n) => n.address.toLowerCase()));
  const added: Note[] = [];
  let pending = 0;
  for (const d of deposited) {
    const ours = (d.blindedPoints as Hex[]).map((p) => mine.get(p.toLowerCase()));
    if (ours.every((i) => i === undefined)) continue;
    const top = Math.max(...ours.filter((i): i is number => i !== undefined));
    if (top + 1 > wallet.next) wallet.next = top + 1;
    if (wallet.next + GAP > horizon) derive((horizon = wallet.next + GAP));

    const a = announced.get(d.id.toString());
    if (!a) {
      pending++;
      continue;
    }
    for (let k = 0; k < a.pointIndexes.length; k++) {
      const index = ours[Number(a.pointIndexes[k])];
      if (index === undefined) continue;
      const secret = noteSecret(wallet.seed, index);
      if (known.has(secret.address.toLowerCase())) continue;
      const denom = a.denoms[k] as bigint;
      const sig = unblind(fromHex(a.blindSigs[k]), rBytes(secret.r));
      const pk = pool.pubkeys.get(denom.toString());
      if (!pk || !verify(pk, secret.address, sig, domainOf(pool))) throw new Error(`sync: mint signature for note ${index} does not verify`);
      const note: Note = { index, address: secret.address, denom: denom.toString(), sig: toHex(sig), depositId: d.id.toString(), spent: false };
      wallet.notes.push(note);
      known.add(secret.address.toLowerCase());
      added.push(note);
    }
  }
  for (const n of wallet.notes) if (!n.spent) n.spent = await isSpent(rpc, pool, n);
  return { added, pending };
}

/** A note is spent once its nonce key has left sequence 0 in NONCE_MANAGER. */
export async function isSpent(rpc: Rpc, pool: PoolInfo, note: Note): Promise<boolean> {
  const key = noteKey(pool.chainId, pool.address, BigInt(note.denom), note.address);
  const slot = keccak256(concat([pad(pool.address), pad(toHex(key))]));
  return BigInt(await rpc("eth_getStorageAt", [NONCE_MANAGER, slot, "latest"])) !== 0n;
}

export const balance = (w: Wallet): bigint => w.notes.filter((n) => !n.spent).reduce((s, n) => s + BigInt(n.denom), 0n);

// ---------------------------------------------------------------------------------------
// Pay.
// ---------------------------------------------------------------------------------------

export async function feeNow(rpc: Rpc): Promise<bigint> {
  const price = BigInt(await rpc("eth_gasPrice"));
  // The devnet base fee is single-digit wei; keep a floor that clears it with room.
  return price * 2n > 2_000_000n ? price * 2n : 2_000_000n;
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

export async function waitReceipt(rpc: Rpc, hash: Hex, timeoutMs = 180_000): Promise<any> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`${hash} not mined within ${timeoutMs / 1000} s`);
}
