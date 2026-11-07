/**
 * Public endpoints and the demo deployment. Override with ?pool=0x…&from=<block>.
 * None of this is secret.
 */

export const NODE_URL = "https://altmempool.forshtat.com";
export const MEMPOOL_URL = "https://altmempool.forshtat.com/rpc";
export const EXPLORER = "https://altmempoolexplorer.forshtat.com/";
export const CHAIN_ID = 1337;

/** Deployed and staked by `node cli/src/main.ts demo` on 2026-11-07. */
const DEMO_POOL = "0xa6641b28a9e916b985326d9c1a394f3cfd946cfe";
const DEMO_FROM_BLOCK = 10270n;

/** ENSv2 runs on Sepolia (docs.ens.domains, Deployments). Names resolve there, over the
 *  same Anon-RPC route as everything else. */
export const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
/** ENSIP-11 coin type of an EVM chain: 0x80000000 | chainId. 0x80000539 for chain 1337. */
export const DEVNET_COIN_TYPE = 0x80000000n | 1337n;

/** The devnet's shared genesis key, published in the workshop repo. Used for the faucet only. */
export const DEVNET_FUNDER = "0x06f911c1ecb2053bb443ba0a0e28d630c583c3c0c2f334a9ecdc8c7c6ad4ea15" as const;

const q = new URLSearchParams(location.search);
export const POOL = (q.get("pool") ?? DEMO_POOL) as `0x${string}`;
export const FROM_BLOCK = q.has("from") ? BigInt(q.get("from")!) : DEMO_FROM_BLOCK;
