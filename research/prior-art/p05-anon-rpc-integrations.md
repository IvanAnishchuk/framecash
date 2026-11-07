# P5. Apps already integrating Anon-RPC

**Verdict:** done before, for reads and sends on mainnet chains (2026-11-07): Privacy
Pools. Not found: any app that sends frame txs, or that reaches the alt-mempool devnet. Only
the anon-rpc repo was searched; past hackathon submissions were not.

## What we need to know

Which wallets or dapps already route through Anon-RPC, how they handle sends, and
whether any of them talks to a non-mainnet chain. That sets the bar for "how much of the
traffic goes through it".

## Where to look

- The Anon-RPC repo: examples, the harness README, issues and PRs.
- Earlier hackathon submissions to an Anon-RPC track.

## Findings

- `adopters.json5` (https://github.com/ethereum/anon-rpc at `ae7e697a`) lists one app,
  Privacy Pools (https://v2.privacypools.com): it "can route every RPC call through anon-rpc
  when users turn on Connect with Tor", with tor-js. It is "Off by default, and the user
  picks the gateway".
- The bar this sets, and where framecash differs:
  - framecash routes through Anon-RPC **by default**. The track asks for that, and Privacy
    Pools does not do it.
  - framecash reaches a non-mainnet chain, the EIP-8141 devnet, plus Sepolia for ENS.
  - framecash sends a new tx type (`eth_sendFrameTransaction`) through it, to a second
    endpoint (Skandha). That surfaced F9's header problem with the Nym worker.
  - The app shows each call's route in a traffic list, and has a "direct" route for the
    on/off comparison the judging asks about.

## Evidence

- `adopters.json5`, `walletsAndApps`, at the commit above.
