// F3 probe: which keyed-nonce forms does the devnet accept, and does each one stop a replay?
// Reuses the F4 contract (approves any tx its owner signs), so build that probe first.
import fs from "node:fs";
import { type Hex, concat, encodeDeployData, encodeFunctionData, keccak256, pad, parseAbi, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MODE, SCHEME, type FrameTx, signEntry, toWire } from "../../lib/src/frametx.ts";

const ETHREX = process.env.ETHREX_URL ?? "https://altmempool.forshtat.com";
const SKANDHA = process.env.SKANDHA_URL ?? "https://altmempool.forshtat.com/rpc";
const CHAIN_ID = 1337;
const FUNDER = "0x06f911c1ecb2053bb443ba0a0e28d630c583c3c0c2f334a9ecdc8c7c6ad4ea15" as Hex; // devnet genesis, funding only
const NONCE_MANAGER = "0x0000000000000000000000000000000000008250" as Hex;
const GAS_PRICE = 2_000_000n;
const U64 = 1n << 64n;

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.code} ${body.error.message}`);
  return body.result;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function receipt(hash: Hex): Promise<any> {
  for (let i = 0; i < 90; i++) {
    const r = await rpc(ETHREX, "eth_getTransactionReceipt", [hash]);
    if (r) return r;
    await sleep(2000);
  }
  throw new Error(`${hash} not mined in 180 s`);
}

async function legacy(key: Hex, to: Hex | null, value: bigint, data: Hex, gas: bigint): Promise<any> {
  const acct = privateKeyToAccount(key);
  for (let attempt = 0; ; attempt++) {
    try {
      const nonce = Number(await rpc(ETHREX, "eth_getTransactionCount", [acct.address, "pending"]));
      const raw = await acct.signTransaction({ chainId: CHAIN_ID, nonce, to, value, data, gas, gasPrice: GAS_PRICE, type: "legacy" });
      return await receipt(await rpc(ETHREX, "eth_sendRawTransaction", [raw]));
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(200 + Math.random() * 400);
    }
  }
}

const ABI = parseAbi(["constructor(address owner_) payable", "function record()"]);
const slot = (sender: Hex, key: bigint) => keccak256(concat([pad(sender), pad(toHex(key))]));

async function main() {
  const deployer = generatePrivateKey();
  const owner = generatePrivateKey();
  const ownerAddr = privateKeyToAccount(owner).address;
  await legacy(FUNDER, privateKeyToAccount(deployer).address, 2n * 10n ** 17n, "0x", 250_000n);
  const bytecode = JSON.parse(fs.readFileSync("../f04-signer-not-sender/out/SignerProbe.sol/SignerProbe.json", "utf8")).bytecode.object as Hex;
  const dep = await legacy(deployer, null, 10n ** 16n, encodeDeployData({ abi: ABI, bytecode, args: [ownerAddr] }), 6_000_000n);
  const probe = dep.contractAddress as Hex;
  console.log("probe", probe);

  const tx = (key: bigint, seq: bigint): FrameTx => ({
    chainId: BigInt(CHAIN_ID), nonceKeys: [key], nonceSeq: seq, sender: probe,
    frames: [
      // Unstaked: Skandha counts frame limit + 2,800 signature gas against MAX_VERIFY_GAS 100k.
      { mode: MODE.VERIFY, flags: 3, target: null, limits: { execution: 90_000n, state: 0n }, value: 0n, data: "0x" },
      { mode: MODE.SENDER, flags: 0, target: probe, limits: { execution: 100_000n, state: 0n }, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "record" }) },
    ],
    signatures: [{ scheme: SCHEME.SECP256K1, signer: ownerAddr, msg: "0x", signature: "0x" }],
    fees: { maxPriorityFeePerGas: GAS_PRICE, maxFeePerGas: GAS_PRICE, maxFeePerBlobGas: 0n },
  });

  async function attempt(label: string, key: bigint, seq: bigint): Promise<boolean> {
    try {
      const hash = await rpc(SKANDHA, "eth_sendFrameTransaction", [toWire(await signEntry(tx(key, seq), 0, owner))]);
      const r = await receipt(hash);
      const stored = BigInt(await rpc(ETHREX, "eth_getStorageAt", [NONCE_MANAGER, slot(probe, key), "latest"]));
      console.log(`MINED    ${label}: ${hash} status ${r.status}, NONCE_MANAGER slot = ${stored === U64 - 1n ? "2^64-1" : stored === U64 - 2n ? "2^64-2" : stored}`);
      // ethrex has the receipt before Skandha drops the tx from its pending set.
      await sleep(15_000);
      return true;
    } catch (e) {
      console.log(`REJECTED ${label}: ${(e as Error).message}`);
      return false;
    }
  }

  const fresh = () => BigInt(toHex(crypto.getRandomValues(new Uint8Array(31))));

  // EIP-8250 single-use form, MAX_NONCE_SEQ = 2^64-1, then a replay of it.
  const k1 = fresh();
  await attempt("single-use seq 2^64-1", k1, U64 - 1n);
  await attempt("replay single-use seq 2^64-1", k1, U64 - 1n);
  await attempt("same key at seq 0", k1, 0n);

  // Skandha's types say MAX_NONCE_SEQ = 2^64-2.
  const k2 = fresh();
  await attempt("seq 2^64-2", k2, U64 - 2n);
  await attempt("replay seq 2^64-2", k2, U64 - 2n);

  // Sequential use: the key moves 0 -> 1, so seq 0 replays fail but seq 1 is fresh.
  const k3 = fresh();
  await attempt("sequential seq 0", k3, 0n);
  await attempt("replay sequential seq 0", k3, 0n);
  await attempt("same key at seq 1", k3, 1n);
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
