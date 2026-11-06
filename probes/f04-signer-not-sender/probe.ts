// F4 probe: a Solidity contract drives APPROVE, TXPARAM and SIGPARAM through raw-bytecode
// helpers, and approves a frame tx signed by a key that is not tx.sender.
import fs from "node:fs";
import { type Hex, decodeEventLog, encodeDeployData, encodeFunctionData, parseAbi, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MODE, SCHEME, type FrameTx, sigHash, signEntry, toWire, txHash } from "./frametx.ts";

const ETHREX = process.env.ETHREX_URL ?? "https://altmempool.forshtat.com";
const SKANDHA = process.env.SKANDHA_URL ?? "https://altmempool.forshtat.com/rpc";
const CHAIN_ID = 1337;
// The devnet's shared genesis key, published on purpose in the workshop repo. Funding only.
const FUNDER = "0x06f911c1ecb2053bb443ba0a0e28d630c583c3c0c2f334a9ecdc8c7c6ad4ea15" as Hex;
// The devnet base fee is 7 wei. This clears it by a wide margin.
const GAS_PRICE = 2_000_000n;
// A transfer to a new account costs ~205k here (new-account state gas). With a 21k limit
// ethrex answers "Account does not have enough balance to cover the tx cost".
const TRANSFER_GAS = 250_000n;

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
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

async function legacy(key: Hex, to: Hex | null, value: bigint, data: Hex = "0x", gas = 100_000n): Promise<any> {
  const acct = privateKeyToAccount(key);
  for (let attempt = 0; ; attempt++) {
    try {
      const nonce = Number(await rpc(ETHREX, "eth_getTransactionCount", [acct.address, "pending"]));
      const raw = await acct.signTransaction({ chainId: CHAIN_ID, nonce, to, value, data, gas, gasPrice: GAS_PRICE, type: "legacy" });
      return await receipt(await rpc(ETHREX, "eth_sendRawTransaction", [raw]));
    } catch (e) {
      if (attempt >= 8) throw e; // the funder key is shared, so nonces collide
      await sleep(200 + Math.random() * 400);
    }
  }
}

function keys(): { deployer: Hex; owner: Hex } {
  try {
    process.loadEnvFile(".env");
  } catch {}
  let { PROBE_DEPLOYER_KEY: deployer, PROBE_OWNER_KEY: owner } = process.env as Record<string, Hex | undefined>;
  if (!deployer || !owner) {
    deployer = generatePrivateKey();
    owner = generatePrivateKey();
    fs.writeFileSync(".env", `PROBE_DEPLOYER_KEY=${deployer}\nPROBE_OWNER_KEY=${owner}\n`);
  }
  return { deployer, owner };
}

const ABI = parseAbi([
  "constructor(address owner_) payable",
  "function record()",
  "event Seen(address signer, uint256 nonceSeq, uint256 nonceKeyCount, uint256 nonceKey0, bytes32 sigHash)",
]);

async function main() {
  console.log("ethrex ", await rpc(ETHREX, "web3_clientVersion"));
  console.log("skandha", await rpc(SKANDHA, "web3_clientVersion"));

  const { deployer, owner } = keys();
  const deployerAddr = privateKeyToAccount(deployer).address;
  const ownerAddr = privateKeyToAccount(owner).address;
  if (BigInt(await rpc(ETHREX, "eth_getBalance", [deployerAddr, "latest"])) < 10n ** 17n) {
    await legacy(FUNDER, deployerAddr, 2n * 10n ** 17n, "0x", TRANSFER_GAS);
  }

  const bytecode = JSON.parse(fs.readFileSync("out/SignerProbe.sol/SignerProbe.json", "utf8")).bytecode.object as Hex;
  const dep = await legacy(deployer, null, 10n ** 16n, encodeDeployData({ abi: ABI, bytecode, args: [ownerAddr] }), 6_000_000n);
  if (dep.status !== "0x1") throw new Error(`deploy reverted: ${dep.transactionHash}`);
  const probe = dep.contractAddress as Hex;
  console.log("probe  ", probe, "owner", ownerAddr);

  // A fresh keyed nonce at sequence 0, so the probe also shows TXPARAM(0x10).
  const nonceKey = BigInt(toHex(crypto.getRandomValues(new Uint8Array(31))));
  let tx: FrameTx = {
    chainId: BigInt(CHAIN_ID),
    nonceKeys: [nonceKey],
    nonceSeq: 0n,
    sender: probe,
    frames: [
      { mode: MODE.VERIFY, flags: 3, target: null, limits: { execution: 100_000n, state: 0n }, value: 0n, data: "0x" },
      {
        mode: MODE.SENDER, flags: 0, target: probe, limits: { execution: 100_000n, state: 0n }, value: 0n,
        data: encodeFunctionData({ abi: ABI, functionName: "record" }),
      },
    ],
    // The signer is the owner key, not tx.sender. The protocol verifies it before any frame.
    signatures: [{ scheme: SCHEME.SECP256K1, signer: ownerAddr, msg: "0x", signature: "0x" }],
    fees: { maxPriorityFeePerGas: GAS_PRICE, maxFeePerGas: GAS_PRICE, maxFeePerBlobGas: 0n },
  };
  tx = await signEntry(tx, 0, owner);
  const local = txHash(tx);

  const sent = await rpc(SKANDHA, "eth_sendFrameTransaction", [toWire(tx)]);
  console.log("sent   ", sent, sent === local ? "(matches local hash)" : `(local ${local})`);
  const r = await receipt(sent);
  const frames = (r.frameReceipts ?? []).map((f: any) => f.status);
  console.log("status ", r.status, "frames", frames.join(","), "block", Number(r.blockNumber), "payer", r.payer);

  const log = r.logs.find((l: any) => l.address.toLowerCase() === probe.toLowerCase());
  if (!log) throw new Error("no Seen log");
  const seen = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics }).args as any;
  const checks = {
    "SIGPARAM signer == owner (not sender)": seen.signer.toLowerCase() === ownerAddr.toLowerCase(),
    "TXPARAM(0x01) nonce_seq == 0": seen.nonceSeq === 0n,
    "TXPARAM(0x0E) key count == 1": seen.nonceKeyCount === 1n,
    "TXPARAM(0x10) key0 == our key": seen.nonceKey0 === nonceKey,
    "TXPARAM(0x08) == local sig hash": seen.sigHash === sigHash(tx),
  };
  for (const [k, v] of Object.entries(checks)) console.log(v ? "PASS" : "FAIL", k);
  if (!Object.values(checks).every(Boolean) || frames.some((s: string) => s !== "0x1")) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
