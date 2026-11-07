import { type Hex, createPublicClient, custom, formatEther, isAddress, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import {
  type Chain,
  type PoolInfo,
  type Wallet,
  balance,
  depositCalldata,
  feeNow,
  httpRpc,
  newSeed,
  planDeposit,
  preparePayment,
  readPool,
  submitPayment,
  sync,
  waitPayment,
  waitReceipt,
} from "../../lib/src/index.ts";
import { ROUTES, type Route, type RouteId, openRoute } from "./anon.ts";
import {
  CHAIN_ID,
  DEVNET_COIN_TYPE,
  DEVNET_FUNDER,
  EXPLORER,
  FROM_BLOCK,
  MEMPOOL_URL,
  NODE_URL,
  POOL,
  SEPOLIA_RPC,
} from "./config.ts";

// ---------------------------------------------------------------------------------------
// Device storage: the seed and a funding key. Nothing here has to reach anyone else.
// ---------------------------------------------------------------------------------------

const KEY = `framecash.${POOL.toLowerCase()}`;

function loadLocal<T>(name: string, fresh: () => T): T {
  try {
    const raw = localStorage.getItem(`${KEY}.${name}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fresh();
}

function saveLocal(name: string, value: unknown): void {
  try {
    localStorage.setItem(`${KEY}.${name}`, JSON.stringify(value));
  } catch {}
}

let wallet: Wallet = loadLocal("wallet", () => ({ seed: newSeed(), next: 0, notes: [] }));
const funderKey: Hex = loadLocal("funder", () => generatePrivateKey());
saveLocal("wallet", wallet);
saveLocal("funder", funderKey);
const funder = privateKeyToAccount(funderKey);

// ---------------------------------------------------------------------------------------
// DOM helpers. Text only: chain data never becomes markup.
// ---------------------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function h(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) e.append(c);
  return e;
}

// ---------------------------------------------------------------------------------------
// The route: every RPC call below goes through it, and the traffic list shows each one.
// ---------------------------------------------------------------------------------------

let route: Route;
let chain: Chain;
let pool: PoolInfo | undefined;
let calls = 0;

function logCall(endpoint: string, method: string) {
  calls++;
  const anon = ROUTES[route.id].anonymizes;
  const list = $("calls");
  list.prepend(h("li", "", h("span", "m", method), h("span", "e", endpoint), h("span", `r ${anon ? "anon" : "plain"}`, route.id)));
  while (list.children.length > 60) list.lastChild?.remove();
  $("callcount").textContent = `${calls} calls, all via ${route.id}`;
}

async function useRoute(id: RouteId) {
  route?.close();
  route = openRoute(id);
  const status = $("routestatus");
  status.textContent = id === "direct" ? "direct" : "bootstrapping…";
  status.className = "pill wait";
  chain = {
    node: httpRpc(NODE_URL, route.fetch, (m) => logCall("ethrex", m)),
    mempool: httpRpc(MEMPOOL_URL, route.fetch, (m) => logCall("skandha", m)),
  };
  try {
    await route.ready;
    status.textContent = ROUTES[id].anonymizes ? `${id}: ready` : `${id}: NOT anonymous`;
    status.className = `pill ${ROUTES[id].anonymizes ? "ok" : "warn"}`;
  } catch (e) {
    status.textContent = `${id} failed: ${(e as Error).message}`;
    status.className = "pill bad";
    throw e;
  }
}

// ---------------------------------------------------------------------------------------
// Actions.
// ---------------------------------------------------------------------------------------

function say(msg: string, kind: "info" | "ok" | "bad" = "info") {
  const el = $("msg");
  el.textContent = msg;
  el.className = kind;
}

async function busy(label: string, fn: () => Promise<void>) {
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  say(`${label}…`);
  try {
    await fn();
  } catch (e) {
    say((e as Error).message, "bad");
  } finally {
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
    render();
  }
}

async function getPool(): Promise<PoolInfo> {
  pool ??= await readPool(chain.node, POOL, FROM_BLOCK);
  return pool;
}

async function sendLegacy(key: Hex, to: Hex, value: bigint, data: Hex = "0x", gas?: bigint): Promise<any> {
  const acct = privateKeyToAccount(key);
  const limit =
    gas ?? (BigInt(await chain.node("eth_estimateGas", [{ from: acct.address, to, value: `0x${value.toString(16)}`, data }])) * 13n) / 10n;
  const nonce = Number(await chain.node("eth_getTransactionCount", [acct.address, "pending"]));
  const raw = await acct.signTransaction({ chainId: CHAIN_ID, nonce, to, value, data, gas: limit, gasPrice: 2_000_000n, type: "legacy" });
  const r = await waitReceipt(chain.node, await chain.node("eth_sendRawTransaction", [raw]));
  if (r.status !== "0x1") throw new Error(`tx ${r.transactionHash} reverted`);
  return r;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function faucet() {
  // ~205k gas: a transfer to a new account pays new-account state gas on this devnet.
  await sendLegacy(DEVNET_FUNDER, funder.address, parseEther("0.5"), "0x", 250_000n);
  say("0.5 devnet ETH sent to your funding wallet", "ok");
}

async function addMoney() {
  const p = await getPool();
  const amount = parseEther($<HTMLInputElement>("addamt").value || "0");
  const points = planDeposit(wallet, p, amount);
  saveLocal("wallet", wallet);
  const r = await sendLegacy(funderKey, p.address, amount, depositCalldata(points));
  say(`Deposited ${formatEther(amount)} ETH (${points.length} blinded points) in block ${BigInt(r.blockNumber)}. Waiting for the mint…`, "ok");
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    const { added, pending } = await sync(chain.node, p, wallet);
    saveLocal("wallet", wallet);
    render();
    if (added.length && !pending) return say(`Minted ${added.length} notes.`, "ok");
  }
  say("The deposit is on chain; the mint has not answered yet. Press Sync later.");
}

async function doSync() {
  const { added, pending } = await sync(chain.node, await getPool(), wallet);
  saveLocal("wallet", wallet);
  say(`${added.length} new notes${pending ? `, ${pending} deposit(s) waiting for the mint` : ""}`, "ok");
}

/**
 * A payee is a 0x address or an ENS name. A name resolves on Sepolia (ENSv2) to its address
 * for the devnet's coin type, and the lookup goes over the current Anon-RPC route.
 */
async function payee(input: string): Promise<Hex> {
  if (isAddress(input)) return input;
  if (!input.includes(".")) throw new Error("the payee must be a 0x address or an ENS name");
  const sepoliaRpc = httpRpc(SEPOLIA_RPC, route.fetch, (m) => logCall("sepolia", m));
  const ens = createPublicClient({ chain: sepolia, transport: custom({ request: ({ method, params }) => sepoliaRpc(method, params) }) });
  const addr = await ens.getEnsAddress({ name: normalize(input), coinType: DEVNET_COIN_TYPE });
  if (!addr) throw new Error(`${input} has no address for the devnet (coin type 0x${DEVNET_COIN_TYPE.toString(16)}) on ENSv2`);
  say(`${input} → ${addr}`);
  return addr;
}

async function pay() {
  const p = await getPool();
  const to = await payee($<HTMLInputElement>("payto").value.trim());
  const amount = parseEther($<HTMLInputElement>("payamt").value || "0");
  const payment = await preparePayment(p, wallet, to, amount, await feeNow(chain.node));
  saveLocal("wallet", wallet);
  let hash: Hex;
  try {
    hash = await submitPayment(chain, payment);
  } catch (e) {
    // Known (F9): the Nym worker drops the request's content-type, which Skandha requires.
    // The note is not spent: the tx never entered the mempool.
    if (/Unsupported Media Type/.test((e as Error).message)) {
      throw new Error(`${route.id} dropped the request's content-type, so Skandha refused the payment. The note is unspent. Reads work over ${route.id}; to pay, use another route.`);
    }
    throw e;
  }
  say(`Sent ${hash.slice(0, 18)}… to the alt mempool, with the pool as sender. Waiting for inclusion…`);
  const r = await waitPayment(chain, hash);
  const ok = (r.frameReceipts ?? []).every((f: any) => f.status === "0x1");
  const link = h("a", "", "explorer");
  link.setAttribute("href", EXPLORER);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noreferrer");
  $("lasttx").replaceChildren(
    "Last payment ", h("code", "", hash), ` in block ${BigInt(r.blockNumber)}, payer `, h("code", "", String(r.payer)), " (", link, ", search the hash)",
  );
  say(ok ? `Paid ${formatEther(amount)} ETH. The change comes back as new notes once the mint signs.` : "Included, but a frame failed", ok ? "ok" : "bad");
  await sleep(6000);
  await sync(chain.node, p, wallet);
  saveLocal("wallet", wallet);
}

async function restore() {
  const seed = $<HTMLInputElement>("seedin").value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new Error("a seed is 0x and 64 hex digits");
  wallet = { seed: seed as Hex, next: 0, notes: [] };
  const { added } = await sync(chain.node, await getPool(), wallet);
  saveLocal("wallet", wallet);
  say(`Restored ${added.length} notes from the seed alone.`, "ok");
}

// ---------------------------------------------------------------------------------------
// View.
// ---------------------------------------------------------------------------------------

function render() {
  $("balance").textContent = `${formatEther(balance(wallet))} ETH`;
  $("notecount").textContent = `${wallet.notes.filter((n) => !n.spent).length} notes`;
  $("notes").replaceChildren(
    ...wallet.notes.map((n) =>
      h("li", n.spent ? "spent" : "", `${formatEther(BigInt(n.denom))} ETH `, h("code", "", `${n.address.slice(0, 10)}…`), n.spent ? " spent" : ""),
    ),
  );
  $("funder").textContent = funder.address;
  $("pooladdr").textContent = POOL;
}

function wire() {
  $("faucet").onclick = () => busy("Funding", faucet);
  $("add").onclick = () => busy("Depositing", addMoney);
  $("sync").onclick = () => busy("Syncing", doSync);
  $("pay").onclick = () => busy("Paying", pay);
  $("restore").onclick = () => busy("Restoring", restore);
  $("showseed").onclick = () => {
    $("seedout").textContent = wallet.seed;
  };
  const sel = $<HTMLSelectElement>("route");
  for (const id of Object.keys(ROUTES) as RouteId[]) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = ROUTES[id].label;
    sel.append(o);
  }
  sel.onchange = () => busy("Switching route", () => useRoute(sel.value as RouteId));
}

// Nox is the default: the one route that carries every call, the payment send included
// (F9). ?route=tor-js, nym, passthrough or direct picks another.
const asked = new URLSearchParams(location.search).get("route") as RouteId | null;
const start: RouteId = asked && asked in ROUTES ? asked : "nox";

wire();
render();
$<HTMLSelectElement>("route").value = start;
busy(`Starting Anon-RPC (${start})`, async () => {
  await useRoute(start);
  await doSync();
});
