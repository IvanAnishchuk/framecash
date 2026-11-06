# Research tracker

Two kinds of question, both to be settled before the event:
- **Feasibility (F):** can this part work at all on the tools that will exist at the
  event? A "fails" answer changes the design or drops a sponsor track.
- **Prior art (P):** has someone built this already, or written research we should build
  on? A hit means reuse it, differentiate from it, or drop the idea.

Verdicts: `open`, `works`, `fails`, `done before`, `unknown` (looked, couldn't settle).
Each verdict links its evidence. See [`CLAUDE.md`](../CLAUDE.md) for what counts.

## Feasibility

| # | Question | Decides | Verdict |
|---|---|---|---|
| [F1](feasibility/f01-eip2537-on-devnet.md) | Is EIP-2537 (BLS12-381 precompiles) live on the alt-mempool devnet? | Whether the project runs there at all | open |
| [F2](feasibility/f02-staked-validation-budget.md) | Does Skandha admit ~180k of validation gas for a staked sender? | Whether the pool can pay its own gas | open |
| [F3](feasibility/f03-single-use-nonce-keys.md) | Are EIP-8250 single-use nonce keys live? | Nullifier design: nonce key or `spent[]` | open |
| [F4](feasibility/f04-signer-not-sender.md) | Can `self_verify` approve on a SECP256K1 signer that isn't `tx.sender`? | How the note key binds to the sig hash | works |
| [F5](feasibility/f05-cre-write-to-1337.md) | Can a CRE simulation write to chain 1337? | Whether the Chainlink track holds | open |
| [F6](feasibility/f06-cre-log-trigger-frame-blocks.md) | Does the CRE log trigger work on blocks with type-`0x06` txs? | Whether the mint can watch the devnet | open |
| [F7](feasibility/f07-cre-external-leg.md) | What satisfies CRE's "external API/system" requirement? | Whether the workflow needs another piece | open |
| [F8](feasibility/f08-anon-rpc-reaches-devnet.md) | Can tor-js or Nym reach the `altmempool.wtf` hosts? | Whether the Anon-RPC track holds | open |
| [F9](feasibility/f09-anon-rpc-frame-send.md) | Does the Anon-RPC worker pass `eth_sendFrameTransaction` through? | Whether payments are network-private | open |
| [F10](feasibility/f10-ensv2-on-sepolia.md) | Is ENSv2 deployed and usable on Sepolia? | Whether the ENS integration is worth it | open |
| [F11](feasibility/f11-eac-record-scoped-roles.md) | Can ENSv2 EAC roles be scoped to specific records? | ENSv2-central vs cosmetic | open |

## Prior art

| # | Area | Verdict |
|---|---|---|
| [P1](prior-art/p01-ecash-on-evm.md) | Chaumian / blind-signature eCash on EVM chains | open |
| [P2](prior-art/p02-pool-as-frame-sender.md) | Privacy pools as the frame-tx sender, paying their own gas | open |
| [P3](prior-art/p03-bls12-381-solidity.md) | BLS12-381 verification and hash-to-G2 in Solidity after Pectra | open |
| [P4](prior-art/p04-alt-mempool-projects.md) | Projects and demos already on the ERC-8421 alt mempool | open |
| [P5](prior-art/p05-anon-rpc-integrations.md) | Apps already integrating Anon-RPC | open |
| [P6](prior-art/p06-cre-signing-workflows.md) | CRE workflows that hold keys or sign in the confidential handler | open |
| [P7](prior-art/p07-ens-private-receive.md) | Private receiving through ENS: stealth meta-addresses, pre-blinded slots | open |
