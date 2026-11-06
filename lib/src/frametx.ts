// EIP-8141 frame transaction codec, trimmed.
// Derived from skandha packages/executor/src/services/FrameTxService/codec.ts (MIT, Etherspot),
// as vendored in https://github.com/forshtat/mempool-workshop at 902673eb (src/lib/frameTx).
import { RLP, type Input } from "@ethereumjs/rlp";
import { type Hex, keccak256, toBytes, toHex } from "viem";
import { sign } from "viem/accounts";

export const FRAME_TX_TYPE = 0x06;
export const MODE = { DEFAULT: 0, VERIFY: 1, SENDER: 2 } as const;
export const SCHEME = { ARBITRARY: 0, SECP256K1: 1, P256: 2 } as const;

export interface Frame {
  mode: number;
  flags: number;
  target: Hex | null;
  limits: { execution: bigint; state: bigint };
  value: bigint;
  data: Hex;
}

export interface Signature {
  scheme: number;
  signer: Hex;
  msg: Hex;
  signature: Hex;
}

export interface FrameTx {
  chainId: bigint;
  nonceKeys: bigint[];
  nonceSeq: bigint;
  sender: Hex;
  frames: Frame[];
  signatures: Signature[];
  fees: { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint; maxFeePerBlobGas: bigint };
}

const int = (n: bigint): Uint8Array => (n === 0n ? new Uint8Array() : toBytes(toHex(n)));

function encode(tx: FrameTx): Uint8Array {
  const body: Input[] = [
    int(tx.chainId),
    tx.nonceKeys.map(int),
    int(tx.nonceSeq),
    toBytes(tx.sender),
    tx.frames.map((f) => [
      int(BigInt(f.mode)),
      int(BigInt(f.flags)),
      f.target ? toBytes(f.target) : new Uint8Array(),
      [int(f.limits.execution), int(f.limits.state)],
      int(f.value),
      toBytes(f.data),
    ]),
    tx.signatures.map((s) => [int(BigInt(s.scheme)), toBytes(s.signer), toBytes(s.msg), toBytes(s.signature)]),
    [int(tx.fees.maxPriorityFeePerGas), int(tx.fees.maxFeePerGas), int(tx.fees.maxFeePerBlobGas)],
    [], // blob_versioned_hashes
    [], // recent_root_references (EIP-8272)
  ];
  return RLP.encode(body);
}

export const rawTx = (tx: FrameTx): Hex => toHex(new Uint8Array([FRAME_TX_TYPE, ...encode(tx)]));
export const txHash = (tx: FrameTx): Hex => keccak256(rawTx(tx));

/** EIP-8141 §Signature Hash: signatures with an empty `msg` have their bytes elided. */
export function sigHash(tx: FrameTx): Hex {
  const elided = { ...tx, signatures: tx.signatures.map((s) => (s.msg === "0x" ? { ...s, signature: "0x" as Hex } : s)) };
  return keccak256(rawTx(elided));
}

/** Sign signature entry `index` over the canonical sig hash, packed as v(0/1) || r || s. */
export async function signEntry(tx: FrameTx, index: number, key: Hex): Promise<FrameTx> {
  const s = await sign({ hash: sigHash(tx), privateKey: key });
  const v = (Number(s.v) - 27).toString(16).padStart(2, "0");
  const signature = `0x${v}${s.r.slice(2)}${s.s.slice(2)}` as Hex;
  return { ...tx, signatures: tx.signatures.map((e, i) => (i === index ? { ...e, signature } : e)) };
}

const h = (n: bigint) => `0x${n.toString(16)}`;

/** The JSON shape Skandha's `eth_sendFrameTransaction` takes. */
export function toWire(tx: FrameTx): unknown {
  return {
    chainId: h(tx.chainId),
    nonceKeys: tx.nonceKeys.map(h),
    nonceSeq: h(tx.nonceSeq),
    sender: tx.sender,
    frames: tx.frames.map((f) => ({
      mode: f.mode,
      flags: f.flags,
      target: f.target,
      limits: { execution: h(f.limits.execution), state: h(f.limits.state) },
      value: h(f.value),
      data: f.data,
    })),
    signatures: tx.signatures,
    fees: {
      maxPriorityFeePerGas: h(tx.fees.maxPriorityFeePerGas),
      maxFeePerGas: h(tx.fees.maxFeePerGas),
      maxFeePerBlobGas: h(tx.fees.maxFeePerBlobGas),
    },
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
}
