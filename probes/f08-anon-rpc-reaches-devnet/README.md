# F8 probe: Anon-RPC routes to the devnet

Answers [`research/feasibility/f08-anon-rpc-reaches-devnet.md`](../../research/feasibility/f08-anon-rpc-reaches-devnet.md).

## What it checks

The app itself is the probe. It loads `@anon-rpc/browser-harness` 0.4.0 with each
anonymizing worker from anon-rpc's `adopters.json5`, and sends its normal traffic through
it: `eth_chainId`, `eth_call`, `eth_getLogs`, `eth_getStorageAt` and `eth_sendRawTransaction`
to ethrex at `https://altmempool.forshtat.com`. The traffic list in the page names the route
of every call.

## Run

```sh
npm install --prefix app
npx --prefix app vite app            # http://localhost:5173/?route=nym  (or tor-js)
node cli/src/main.ts mint --watch    # so deposits get minted
```

Then press Sync, Get devnet ETH and Add money. This run was driven in Chromium through
Playwright.

## Result, 2026-11-07: works over Nym; tor-js not settled

Browser log: [`browser-console-2026-11-06T2343Z.log`](browser-console-2026-11-06T2343Z.log)
(times in the browser's UTC).

**Nym** (specifier `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0`): the bundle verified and
booted, registered with `wss://bulgaria.nymgateway.com:9001/` and reported `nym tunnel
ready` about 8 s after boot. Then, all through Nym:
- Sync: 9 calls (`eth_chainId`, 6 × `eth_call`, 2 × `eth_getLogs`) answered by ethrex;
- the devnet faucet transfer and a 0.023 ETH deposit (`eth_estimateGas`,
  `eth_getTransactionCount`, `eth_sendRawTransaction`, receipt polling) were mined;
- the mint's announcement was read back and unblinded into notes.

**tor-js** (specifier `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e`): the bundle verified
and booted, but its only gateway, the demonstration KPS relay `152.236.3.22:12298` from
`adopters.json5`, timed out (`dial … timed out`), and the Tor directory download failed
after it. A plain TCP connect to that address from this machine also timed out while a
control connect to `1.1.1.1:443` succeeded, so the relay looks down rather than blocked
here; KPS may use UDP, which that check does not cover. `adopters.json5` itself warns the
demo gateway "may disappear at any time". Whether tor-js reaches the devnet is therefore
**unknown**; it needs a working gateway (ours, or one from the anon-rpc team on site).

The specifier read is one plain request to a mainnet RPC
(`https://ethereum-rpc.publicnode.com`), before any worker exists. It reveals that this
browser loads an anon-rpc worker, nothing about framecash.
