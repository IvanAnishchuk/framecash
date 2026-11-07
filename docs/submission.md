# ETHGlobal Mumbai submission: draft

Paste-ready text for the form. Every number and hash here comes from a run on the devnet,
with the evidence linked in the repo.

## Project name

framecash

## Short description (one line)

eCash notes that pay their own gas: one EIP-8141 frame transaction, the pool as sender, every call over a mixnet.

## Description

framecash is a Chaumian eCash wallet in which the pool contract, not the user, sends every
payment.

You deposit ETH from any wallet with a set of blinded points. A mint, running as a
Chainlink CRE workflow, blind-signs them, and you unblind them into notes that nobody can
link to the deposit. To pay, you send one EIP-8141 frame transaction whose sender is the
pool. Its VERIFY frame checks the mint's BLS12-381 signature on chain, checks that the note
key signed this exact transaction, and approves paying the gas from the note. The SENDER
frame pays the payee and turns the rest into change, which the mint signs back into fresh
notes. There is no relayer, and no fresh address ever needs funding.

The note's nonce key is its nullifier: the protocol consumes it when the pool approves, so
a note can't be spent twice. Validation reads no storage that payments write, so pending
payments never invalidate each other.

All of the wallet's traffic goes through Anon-RPC over the Nox mixnet: reads, deposits,
the spent check, and the payment itself. The RPC node and the alt mempool never see the
user's IP next to a payment.

Running on the EIP-8141 devnet (chain 1337). The browser app paid
`0x8c7be807d1fc76e69a1b9b856d94aee26996b80c62a1990381a25b246d8f0410` (block 11030), with
the pool as payer and 43 RPC calls, all via Nox.

## How it's made

- **Contract (Solidity, Foundry).** `FramePool` combines teecash's blind-mint deposit and
  announce logic with a new pay path. Solidity can't emit the frame opcodes (APPROVE,
  TXPARAM, SIGPARAM, FRAMEPARAM, FRAMEDATACOPY), so the pool deploys raw-bytecode helpers
  of a few bytes each and calls them: APPROVE by delegatecall, the reads by staticcall.
- **Gas.** VERIFY costs 317k gas: hash-to-G2 and a pairing on the EIP-2537 precompiles,
  plus introspection. That is over the canonical 100k cap. The pool stakes itself in the
  ERC-8421 registry from its constructor, and the Skandha alt mempool admits it.
- **Nullifier.** The devnet doesn't support EIP-8250's single-use form, and we found that
  a consumed key can be reused at sequence 1. So the pool accepts only sequence 0.
- **Mint.** A Chainlink CRE workflow in Go: a log trigger, blind signing in the
  confidential handler, and `WriteReport` back to the pool. CRE has no forwarder on chain
  1337, so we declared it under the CLI's `experimental-chains` setting with a forwarder of
  our own. The workflow also mints change deposits emitted from inside frame transactions,
  live.
- **Client (TypeScript).** Seed-derived note keys and blinding factors, so a new device
  restores every note from the seed and a chain scan. A frame-tx codec, and a browser app on
  `@anon-rpc/browser-harness`.
- **Anon-RPC.** Nox is the default route. Nym drops the `content-type` header that Skandha
  requires, and the tor-js demo gateway was down. We documented both.
- **Tests.** 22 forge tests, with BLS vectors produced by the TypeScript code over FFI, plus
  TypeScript and Go tests. Each feasibility question has a probe with its result in
  `research/`.

## Links

- Repo: https://github.com/IvanAnishchuk/framecash
- Live demo: https://ivananishchuk.github.io/framecash/ (deposits are minted while the CRE
  mint runs; it currently runs on my machine)
- Explorer: https://altmempoolexplorer.forshtat.com/ (search the tx hashes above)

## Prizes

**Ethereum Foundation: alternative mempool** (also qualifies for Anon-RPC; EF places
projects in one track)
> Every payment is an admitted alt-mempool frame tx with a staked sender whose VERIFY frame
> needs 317k gas, over three times the canonical 100k: a privacy protocol that runs on the
> per-entity budget, which is the track's own example. Admitted payments:
> `0xe1984cd46fe86328d09be6ef22dd55bd2aa526a89d5e5f2ab6c7f440973be9c0` (Skandha record:
> included, all rules pass), `0x8c7be807d1fc76e69a1b9b856d94aee26996b80c62a1990381a25b246d8f0410`.
> The trade-offs (sequence-0 nullifier, no storage reads in validation, a pinned frame list)
> are in the README.

**Anon-RPC** (the same EF prize; for context)
> On by default, for all traffic: reads, the spent check (`eth_getStorageAt` on
> NONCE_MANAGER, which would otherwise tie your IP to your exact notes), deposits, and
> `eth_sendFrameTransaction` to Skandha. All of it goes over Nox, to a non-mainnet devnet,
> and the app shows each call's route. The deliberate exclusions are listed in the README.
> We also found and documented why Nym can't send to Skandha.

**Chainlink: Best workflow with CRE**
> The mint is the CRE workflow, used for real: a log trigger on deposits, blind signing in
> the confidential handler with keys from the Vault, and `WriteReport` to announce. It is
> simulated with the CRE CLI against the EIP-8141 devnet through `experimental-chains`.
> Writes: `0x582972cface2bc936e1b09489cd46dc837ab57620ca0fa371f1c4d9e9be73668`, and, live, a
> change deposit picked out of a frame tx,
> `0x4a84b5f372514d608347a4abd4b22b0da74ef9ddc882df925bd1cd484c7d622b`.

## Demo video script (about 2.5 minutes)

1. **(0:00) Problem.** Privacy pools need a relayer or a funded fresh address to withdraw.
   Frame transactions let the pool itself be the sender.
2. **(0:20) App, Add money.** The deposit is public. Point at the traffic list: every call
   goes through Nox.
3. **(0:45) Terminal, `just cre-mint`.** The CRE workflow fires and signs. Back in the app,
   notes appear, unblinded and verified.
4. **(1:10) Pay.** Show the frame tx on the explorer: sender and payer are the pool, and
   VERIFY used 317k gas. `eth_sendFrameTransaction` in the traffic list, via Nox.
5. **(1:40) Change.** CRE mints the change from inside the frame tx, and the balance
   updates.
6. **(2:00) Restore from seed** on a fresh browser: all notes come back.
7. **(2:20) Close.** The repo, the probes, and the honest gaps (README).

Screenshots: `docs/screenshots/01-minted-over-nox.png`, `02-paid-over-nox.png`,
`03-change-minted-by-cre.png`.
