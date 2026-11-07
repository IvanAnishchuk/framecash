// framecash CLI. Operator and developer tool: deploy, the local mint, and a wallet for tests.
// It talks to the devnet directly. The user-facing client is the browser app, which routes
// every call through Anon-RPC.
//
//   node cli/src/main.ts <command> [args]     (run from the repo root; `just` wraps these)
import fs from "node:fs";
import path from "node:path";
import { type Hex, decodeEventLog, encodeDeployData, encodeFunctionData, formatEther, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  type Chain,
  LADDER,
  POOL_ABI,
  type Wallet,
  answer,
  balance,
  depositCalldata,
  feeNow,
  httpRpc,
  mintKey,
  newSeed,
  planDeposit,
  preparePayment,
  readPool,
  submitPayment,
  sync,
  waitPayment,
  waitReceipt,
} from "../../lib/src/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ENV = path.join(ROOT, ".env");
const STATE = path.join(ROOT, ".tmp/framecash.json");

try {
  process.loadEnvFile(ENV);
} catch {}
const NODE_URL = process.env.ETHREX_URL ?? "https://altmempool.forshtat.com";
const MEMPOOL_URL = process.env.SKANDHA_URL ?? "https://altmempool.forshtat.com/rpc";
const EXPLORER = "https://altmempoolexplorer.forshtat.com/";
// The devnet's shared genesis key, published in the workshop repo for funding. Funding only.
const DEVNET_FUNDER = "0x06f911c1ecb2053bb443ba0a0e28d630c583c3c0c2f334a9ecdc8c7c6ad4ea15" as Hex;
// ERC-8421 staking registry on the devnet (workshop docs/findings.md); minStake 0.01 ETH.
const REGISTRY = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f" as Hex;
const STAKE = parseEther("0.012");
const GAS_PRICE = 2_000_000n;

const chain: Chain = { node: httpRpc(NODE_URL), mempool: httpRpc(MEMPOOL_URL) };

// ---------------------------------------------------------------------------------------
// State and keys.
// ---------------------------------------------------------------------------------------

interface State {
  pool?: Hex;
  fromBlock?: string;
  wallet: Wallet;
}

function load(): State {
  if (!fs.existsSync(STATE)) return { wallet: { seed: newSeed(), next: 0, notes: [] } };
  return JSON.parse(fs.readFileSync(STATE, "utf8"));
}

function save(s: State): void {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, `${JSON.stringify(s, null, 2)}\n`);
}

function env(name: string): Hex {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; run \`init\` first`);
  return v as Hex;
}

const deployerKey = () => env("FRAMECASH_DEPLOYER_KEY");
const mintEoaKey = () => env("FRAMECASH_MINT_KEY");
const mintKeys = () => env("FRAMECASH_MINT_BLS").split(",").map((sk, i) => mintKey(LADDER[i], BigInt(sk)));

// ---------------------------------------------------------------------------------------
// Plain transactions.
// ---------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(key: Hex, to: Hex | null, value: bigint, data: Hex = "0x", gas?: bigint): Promise<any> {
  const acct = privateKeyToAccount(key);
  const limit =
    gas ??
    (BigInt(await chain.node("eth_estimateGas", [{ from: acct.address, to, value: `0x${value.toString(16)}`, data }])) * 13n) / 10n;
  for (let attempt = 0; ; attempt++) {
    try {
      const nonce = Number(await chain.node("eth_getTransactionCount", [acct.address, "pending"]));
      const raw = await acct.signTransaction({ chainId: 1337, nonce, to, value, data, gas: limit, gasPrice: GAS_PRICE, type: "legacy" });
      const r = await waitReceipt(chain.node, await chain.node("eth_sendRawTransaction", [raw]));
      if (r.status !== "0x1") throw new Error(`tx ${r.transactionHash} reverted`);
      return r;
    } catch (e) {
      // The funder key is shared by everyone on the devnet, so nonces collide.
      if (key !== DEVNET_FUNDER || attempt >= 8) throw e;
      await sleep(200 + Math.random() * 400);
    }
  }
}

async function fund(addr: Hex, min: bigint): Promise<void> {
  const have = BigInt(await chain.node("eth_getBalance", [addr, "latest"]));
  // ~205k gas: a transfer to a new account pays new-account state gas on this devnet.
  if (have < min) await send(DEVNET_FUNDER, addr, min * 2n - have, "0x", 250_000n);
}

async function pool() {
  const s = load();
  if (!s.pool) throw new Error("no pool; run `deploy` first");
  return { s, info: await readPool(chain.node, s.pool, BigInt(s.fromBlock ?? "0")) };
}

// ---------------------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------------------

async function init() {
  const have = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  const add: string[] = [];
  if (!process.env.FRAMECASH_DEPLOYER_KEY) add.push(`FRAMECASH_DEPLOYER_KEY=${generatePrivateKey()}`);
  if (!process.env.FRAMECASH_MINT_KEY) add.push(`FRAMECASH_MINT_KEY=${generatePrivateKey()}`);
  if (!process.env.FRAMECASH_MINT_BLS) {
    // Scalars below the BLS12-381 group order: 31 random bytes each.
    const sks = LADDER.map(() => BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex")}`));
    add.push(`FRAMECASH_MINT_BLS=${sks.map((k) => `0x${k.toString(16)}`).join(",")}`);
  }
  if (add.length) {
    fs.writeFileSync(ENV, `${have}${have && !have.endsWith("\n") ? "\n" : ""}# throwaway devnet keys\n${add.join("\n")}\n`);
    process.loadEnvFile(ENV);
  }
  const deployer = privateKeyToAccount(deployerKey()).address;
  const mint = privateKeyToAccount(mintEoaKey()).address;
  await fund(deployer, parseEther("1"));
  await fund(mint, parseEther("0.2"));
  console.log(`deployer ${deployer} ${formatEther(BigInt(await chain.node("eth_getBalance", [deployer, "latest"])))} ETH`);
  console.log(`mint     ${mint}`);
}

async function deploy() {
  const art = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/out/FramePool.sol/FramePool.json"), "utf8"));
  const mint = privateKeyToAccount(mintEoaKey()).address;
  const keys = mintKeys();
  const data = encodeDeployData({
    abi: POOL_ABI,
    bytecode: art.bytecode.object,
    // forwarder = the mint's EOA (the local mint announces directly; F5 decides CRE), treasury
    // = the same EOA, so the tax pays its gas. One-hour refund delay, seq-0 notes (F3).
    args: [mint, mint, 3600n, [...LADDER], keys.map((k) => `0x${Buffer.from(k.pk).toString("hex")}` as Hex), 0n, REGISTRY, STAKE, 86400],
  });
  const r = await send(deployerKey(), null, parseEther("0.05"), data);
  const s = load();
  s.pool = r.contractAddress;
  s.fromBlock = BigInt(r.blockNumber).toString();
  s.wallet = { seed: s.wallet.seed, next: 0, notes: [] };
  save(s);
  const stake = await chain.node("eth_call", [
    { to: REGISTRY, data: `0x5287ce12${s.pool!.slice(2).padStart(64, "0")}` }, // getDepositInfo(address)
    "latest",
  ]);
  console.log(`pool  ${s.pool} (block ${s.fromBlock}, gas ${BigInt(r.gasUsed)})`);
  console.log(`stake ${formatEther(BigInt(stake.slice(0, 66)))} ETH in ${REGISTRY}`);
}

async function deposit(amountEth: string) {
  const { s, info } = await pool();
  const amount = parseEther(amountEth);
  const points = planDeposit(s.wallet, info, amount);
  const r = await send(deployerKey(), info.address, amount, depositCalldata(points));
  save(s);
  console.log(`deposit ${amountEth} ETH with ${points.length} blinded points: ${r.transactionHash} (gas ${BigInt(r.gasUsed)})`);
}

/** The local mint: answer every pending deposit. `--watch` keeps polling. */
async function mint(flag?: string) {
  const { info } = await pool();
  const keys = mintKeys();
  for (;;) {
    const logs = await chain.node("eth_getLogs", [
      { address: info.address, fromBlock: `0x${info.fromBlock.toString(16)}`, toBlock: "latest" },
    ]);
    for (const l of logs) {
      let ev: any;
      try {
        ev = decodeEventLog({ abi: POOL_ABI, data: l.data, topics: l.topics });
      } catch {
        continue;
      }
      if (ev.eventName !== "Deposited") continue;
      const id = ev.args.id as bigint;
      const st = await chain.node("eth_call", [
        { to: info.address, data: encodeFunctionData({ abi: POOL_ABI, functionName: "deposits", args: [id] }) },
        "latest",
      ]);
      if (BigInt(`0x${st.slice(2 + 64 * 4, 2 + 64 * 5)}`) !== 1n) continue; // status word: 1 = Pending
      const a = answer(id, ev.args.amount, ev.args.blindedPoints, keys, info.rung);
      if (!a) {
        const r = await send(mintEoaKey(), info.address, 0n, encodeFunctionData({ abi: POOL_ABI, functionName: "refundByMint", args: [id] }));
        console.log(`deposit ${id}: too few points, refunded ${r.transactionHash}`);
        continue;
      }
      const r = await send(
        mintEoaKey(),
        info.address,
        0n,
        encodeFunctionData({ abi: POOL_ABI, functionName: "announce", args: [a.id, a.pointIndexes, a.denoms, a.blindSigs] }),
      );
      console.log(`deposit ${id}: announced ${a.denoms.map((d) => formatEther(d)).join(" + ")} ETH, ${r.transactionHash}`);
    }
    if (flag !== "--watch") return;
    await sleep(4000);
  }
}

async function doSync() {
  const { s, info } = await pool();
  const { added, pending } = await sync(chain.node, info, s.wallet);
  save(s);
  for (const n of added) console.log(`+ note ${n.index} ${formatEther(BigInt(n.denom))} ETH  ${n.address}`);
  console.log(`balance ${formatEther(balance(s.wallet))} ETH in ${s.wallet.notes.filter((n) => !n.spent).length} notes, ${pending} deposit(s) waiting for the mint`);
}

async function pay(payee: Hex, amountEth: string) {
  const { s, info } = await pool();
  const p = await preparePayment(info, s.wallet, payee, parseEther(amountEth), await feeNow(chain.node));
  save(s); // the change counters are now taken
  const hash = await submitPayment(chain, p);
  console.log(`payment ${hash}${hash === p.hash ? "" : ` (local hash ${p.hash})`} from note ${p.note.index} (${formatEther(BigInt(p.note.denom))} ETH)`);
  console.log(`         sender = pool ${info.address}, admitted by Skandha; explorer ${EXPLORER}`);
  const r = await waitPayment(chain, hash);
  const frames = (r.frameReceipts ?? []).map((f: any) => `${f.status}${f.gasUsed ? ` gas ${JSON.stringify(f.gasUsed)}` : ""}`);
  console.log(`mined in block ${BigInt(r.blockNumber)}, status ${r.status}, payer ${r.payer}, frames: ${frames.join(" | ")}`);
  return r;
}

async function status() {
  const { s, info } = await pool();
  console.log(`pool    ${info.address}  chain ${info.chainId}  noteSeq ${info.noteSeq}  rung ${formatEther(info.rung)} ETH`);
  console.log(`pool balance ${formatEther(BigInt(await chain.node("eth_getBalance", [info.address, "latest"])))} ETH`);
  for (const n of s.wallet.notes) console.log(`${n.spent ? "spent " : "unspent"} #${n.index} ${formatEther(BigInt(n.denom))} ETH ${n.address}`);
  console.log(`balance ${formatEther(balance(s.wallet))} ETH`);
}

async function restore(seed: Hex) {
  const { s, info } = await pool();
  s.wallet = { seed, next: 0, notes: [] };
  const { added } = await sync(chain.node, info, s.wallet);
  save(s);
  console.log(`restored ${added.length} notes from the seed, balance ${formatEther(balance(s.wallet))} ETH`);
}

/**
 * Write workflow/.env (gitignored) for the CRE simulation: the same four mint scalars the
 * local mint uses, and the mint EOA as the key that pays for the simulated write.
 */
async function workflowEnv() {
  const names = ["SECRET_MINT_KEY_0_001", "SECRET_MINT_KEY_0_01", "SECRET_MINT_KEY_0_1", "SECRET_MINT_KEY_1"];
  const sks = env("FRAMECASH_MINT_BLS").split(",");
  const lines = [
    "# Written by `node cli/src/main.ts workflow-env` from the root .env. Throwaway devnet keys.",
    `CRE_ETH_PRIVATE_KEY=${mintEoaKey().slice(2)}`,
    "CRE_TARGET=devnet-settings",
    ...names.map((n, i) => `${n}=${sks[i]}`),
  ];
  fs.writeFileSync(path.join(ROOT, "workflow/.env"), `${lines.join("\n")}\n`);
  const s = load();
  const cfg = path.join(ROOT, "workflow/blindmint/config.devnet.json");
  const json = JSON.parse(fs.readFileSync(cfg, "utf8"));
  if (s.pool && json.blindMint.toLowerCase() !== s.pool.toLowerCase()) {
    console.log(`note: config.devnet.json names ${json.blindMint}, the CLI state names ${s.pool}`);
  }
  console.log("wrote workflow/.env");
}

async function demo() {
  await init();
  await deploy();
  await deposit("0.123"); // mints 0.122: 1×0.1, 2×0.01, 2×0.001
  await mint();
  await doSync();
  const payee = privateKeyToAccount(generatePrivateKey()).address;
  await pay(payee, "0.004");
  console.log(`payee ${payee} has ${formatEther(BigInt(await chain.node("eth_getBalance", [payee, "latest"])))} ETH`);
  await sleep(4000);
  await mint(); // the change deposit
  await doSync();
  const seed = load().wallet.seed;
  await restore(seed);
  await status();
}

const [cmd, ...args] = process.argv.slice(2);
const commands: Record<string, (...a: string[]) => Promise<unknown>> = {
  init,
  deploy,
  deposit: (a) => deposit(a),
  mint: (f) => mint(f),
  sync: doSync,
  pay: (to, amt) => pay(to as Hex, amt),
  status,
  restore: (seed) => restore(seed as Hex),
  seed: async () => console.log(load().wallet.seed),
  "workflow-env": workflowEnv,
  demo,
};

if (!commands[cmd]) {
  console.error(`usage: main.ts <${Object.keys(commands).join("|")}> [args]`);
  process.exit(2);
}
commands[cmd](...args).catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
