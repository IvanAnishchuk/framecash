# F10. Is ENSv2 deployed and usable on Sepolia?

**Verdict:** works (primary source and a live read, 2026-11-07). Registering a name on it
is not done yet: that needs Sepolia ETH.

## Why it matters

Pay-by-name needs a parent name with its own Permissioned Registry and a Permissioned
Resolver per user.

**If it fails:** ENSv2 only on mainnet means the integration costs real money and may
not be worth doing for a prize that's unlikely to pay.

## How to settle

- Find the ENSv2 Sepolia deployment addresses in the ENS docs or contracts repo, with
  the commit.
- Register a name, create a subname registry, and deploy a resolver, each on Sepolia.

## Findings

- The ENS docs: "Sepolia runs the ENSv2 contracts: the Universal Resolver and the ENS apps
  for Sepolia resolve through this deployment", and the ENSv1 Sepolia contracts "are no
  longer in use". The prize allows "ENSv2 on Ethereum mainnet or Sepolia".
- The Universal Resolver is one proxy at the same address on mainnet and Sepolia, and viem
  2.57.16 ships it for Sepolia: `0xeeeeeeee14d718c2b47d9923deab1335e144eeee`. It has code on
  Sepolia, and the app resolved a name through it over Anon-RPC (`test.eth`, which has no
  address for the devnet coin type).
- Registration on Sepolia costs Sepolia ETH for gas, plus a fee in `MockUSDC`, whose
  `mint` "has no access control". So the cost is a faucet's worth of Sepolia ETH.
- The other contract addresses (registry, factory, resolver implementation) are in the
  Deployments table, which the text export does not render (`<ENSv2Deployments
  chain="sepolia" />`). Read them from https://docs.ens.domains/learn/deployments in a
  browser or from https://sepolia.explorer.ens.domains.

What is built: the app's Pay takes an ENS name and resolves its `addr` for coin type
`0x80000539` (ENSIP-11 for chain 1337) on Sepolia, over the same Anon-RPC route as all its
other calls. What is not built: the per-user name and resolver (see F11), which need a funded
Sepolia key.

## Evidence

- Capture: [`research/sources/docs.ens.domains-llms-full.md`](../sources/docs.ens.domains-llms-full.md),
  fetched 2026-11-07, sha256 `5c60bb01312932a6`.
- `cast code 0xeeeeeeee14d718c2b47d9923deab1335e144eeee` on Sepolia: 2,491 bytes of proxy code.
