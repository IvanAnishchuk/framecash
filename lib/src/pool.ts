/**
 * The FramePool interface and the payment transaction (design §3.3).
 */

import { type Hex, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import { type FrameTx, MODE, SCHEME, signEntry } from "./frametx.ts";

export const POOL_ABI = parseAbi([
  "constructor(address forwarder_, address treasury_, uint64 refundDelay_, uint256[] denoms, bytes[] pubkeys, uint64 noteSeq_, address registry, uint256 stake, uint32 unstakeDelay) payable",
  "function deposit(bytes[] blindedPoints) payable returns (uint256)",
  "function announce(uint256 id, uint256[] pointIndexes, uint256[] denoms, bytes[] blindSigs)",
  "function refundByMint(uint256 id)",
  "function refundByDepositor(uint256 id)",
  "function validate()",
  "function spend(uint256 denom, address note, bytes sig, address payee, uint256 amount, bytes[] changeBlinds)",
  "function mintable(uint256 amount) view returns (uint256)",
  "function noteKey(uint256 denom, address note) view returns (uint256)",
  "function mintPubkeys(uint256 denom) view returns (bytes)",
  "function deposits(uint256 id) view returns (address depositor, uint96 amount, uint32 points, uint64 deadline, uint8 status)",
  "function dst() view returns (bytes)",
  "function nextId() view returns (uint256)",
  "function noteSeq() view returns (uint64)",
  "function rung() view returns (uint256)",
  "function forwarder() view returns (address)",
  "function totalAnnounced() view returns (uint256)",
  "function totalSpent() view returns (uint256)",
  "event Deposited(uint256 indexed id, address indexed depositor, uint256 amount, bytes[] blindedPoints)",
  "event Announced(uint256 indexed id, uint256[] pointIndexes, uint256[] denoms, bytes[] blindSigs)",
  "event Spent(address indexed note, uint256 denom, address indexed payee, uint256 amount, bool paid, uint256 change, uint256 changeId)",
  "event Overdrawn(address indexed note, uint256 denom)",
  "event Refunded(uint256 indexed id, address indexed depositor, uint256 amount)",
  "event Taxed(uint256 indexed id, uint256 amount)",
]);

export const NOTE_TAG = keccak256(toHex("framecash.note.v1"));

/** EIP-8250 single-use form. Accepted by the pool only if it was deployed with it (F3). */
export const MAX_NONCE_SEQ = (1n << 64n) - 1n;

/** The note's nonce key, which is its nullifier. Matches `FramePool.noteKey`. */
export function noteKey(chainId: number, pool: Hex, denom: bigint, note: Hex): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [NOTE_TAG, BigInt(chainId), pool, denom, note],
      ),
    ),
  );
}

/** Frame gas limits of a payment. VERIFY is measured in probes/f02; see the README there. */
export interface PayLimits {
  verify: bigint;
  spend: bigint;
  /** State gas for the change deposit's slots and a payee account that may be new. */
  spendState: bigint;
}

// forge measured validate at 454k with mocked helpers (contracts/test). Under the staked 1M.
export const PAY_LIMITS: PayLimits = { verify: 600_000n, spend: 300_000n, spendState: 1_200_000n };

/**
 * An upper bound on TXPARAM(0x06), the max cost the pool collects. Frame limits, plus a
 * generous allowance for intrinsic, calldata and signature gas.
 */
export function maxCostBound(maxFeePerGas: bigint, limits: PayLimits = PAY_LIMITS): bigint {
  return (limits.verify + limits.spend + limits.spendState + 200_000n) * maxFeePerGas;
}

export interface PayNote {
  key: Hex; // a, the note key
  address: Hex; // A
  denom: bigint;
  sig: Hex; // S, unblinded
}

export interface PayParams {
  chainId: number;
  pool: Hex;
  note: PayNote;
  payee: Hex;
  amount: bigint;
  changeBlinds: Hex[];
  noteSeq: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  limits?: PayLimits;
}

/** Build and sign `[VERIFY validate(), SENDER spend(...)]` with the pool as sender. */
export async function buildPayment(p: PayParams): Promise<FrameTx> {
  const limits = p.limits ?? PAY_LIMITS;
  const room = p.note.denom - p.amount;
  if (p.amount > p.note.denom || maxCostBound(p.maxFeePerGas, limits) > room) {
    throw new Error(`pay: note of ${p.note.denom} cannot cover ${p.amount} plus gas`);
  }
  const tx: FrameTx = {
    chainId: BigInt(p.chainId),
    nonceKeys: [noteKey(p.chainId, p.pool, p.note.denom, p.note.address)],
    nonceSeq: p.noteSeq,
    sender: p.pool,
    frames: [
      {
        mode: MODE.VERIFY, flags: 3, target: p.pool, limits: { execution: limits.verify, state: 0n }, value: 0n,
        data: encodeFunctionData({ abi: POOL_ABI, functionName: "validate" }),
      },
      {
        mode: MODE.SENDER, flags: 0, target: p.pool, limits: { execution: limits.spend, state: limits.spendState }, value: 0n,
        data: encodeFunctionData({
          abi: POOL_ABI,
          functionName: "spend",
          args: [p.note.denom, p.note.address, p.note.sig, p.payee, p.amount, p.changeBlinds],
        }),
      },
    ],
    signatures: [{ scheme: SCHEME.SECP256K1, signer: p.note.address, msg: "0x", signature: "0x" }],
    fees: {
      maxPriorityFeePerGas: p.maxPriorityFeePerGas ?? p.maxFeePerGas,
      maxFeePerGas: p.maxFeePerGas,
      maxFeePerBlobGas: 0n,
    },
  };
  return signEntry(tx, 0, p.note.key);
}
