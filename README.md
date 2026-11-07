# framecash

Blind-signature eCash notes that pay their own gas, as EIP-8141 frame transactions.

You deposit ETH from a normal wallet. A mint blind-signs a set of note keys, and you get
back notes that nobody can link to the deposit. To pay, you send one frame transaction
**whose sender is the pool itself**. The pool checks the mint's BLS signature during
validation, pays the gas, and pays the payee from the note. No relayer is involved, and no
fresh address ever needs funding. Every read and send goes through **Anon-RPC**.

Built at ETHGlobal Mumbai (November 2026). The design record is
[`docs/design.md`](docs/design.md), and every open question and its evidence is in
[`research/README.md`](research/README.md).

## Status, 2026-11-07

**Working on the EIP-8141 devnet (chain 1337), every call over the Nox mixnet:** deposit,
CRE mint, pay with the pool as sender and payer, change minted back into notes by CRE, and
restore from the seed alone.

- **Pool:** `0x27c0e726879c4703d6cef2da49db818ba0abd007`, staked 0.012 ETH in the devnet's
  ERC-8421 staking registry, minted by the CRE workflow.
- **Payment from the browser app, every call over Nox:**
  `0x8c7be807d1fc76e69a1b9b856d94aee26996b80c62a1990381a25b246d8f0410`, included in block
  11030 with the pool as payer. The app's traffic list showed 43 calls, all via Nox.
  Screenshots are in [`docs/screenshots/`](docs/screenshots/).
- **Other admitted alt-mempool payments:**
  - `0xe1984cd46fe86328d09be6ef22dd55bd2aa526a89d5e5f2ab6c7f440973be9c0`, block 10277, CLI.
    Skandha's record says `outcome: included` and every rule `pass`
    ([F2 probe](probes/f02-staked-validation-budget/README.md)).
  - `0x134935cb0851a887ed9d5ae9fe7e11bc1d8727e984d994fb9f47715ecdf26545`, block 10745,
    from a CRE-minted note.

  Look them up on <https://altmempoolexplorer.forshtat.com/>.

Anon-RPC routes: Nox carries everything. Nym carries reads and deposits but drops the
`content-type` header that Skandha requires, so it cannot send a payment. tor-js's only
public gateway was down. See [F8](research/feasibility/f08-anon-rpc-reaches-devnet.md) and
[F9](research/feasibility/f09-anon-rpc-frame-send.md).

**The mint is a Chainlink CRE workflow** (`workflow/`), run with `cre workflow simulate
--broadcast --listen`. It signs in the confidential handler and writes announcements back
through `WriteReport`. On pool `0x27c0e726879c4703d6cef2da49db818ba0abd007` it has minted:
- a deposit (report `0x582972cf…`, block 10730);
- the change from a payment, picked out of the frame tx (`0xd25ab340…`, block 10750);
- live, the change from another payment as it landed (`0x4a84b5f3…`, block 10785).

CRE has no forwarder on chain 1337, so the chain is declared under `experimental-chains`
with our `DevnetForwarder` ([F5](research/feasibility/f05-cre-write-to-1337.md),
[F6](research/feasibility/f06-cre-log-trigger-frame-blocks.md)). Like CRE's mock it checks
no signatures, which is fine on a throwaway devnet and nowhere else. The local mint (`just
mint-watch`) runs the same rule in TypeScript, for the first pool and for runs without CRE.

## How a payment works

```
nonce_keys = [noteKey(d, A)]    nonce_seq = 0
signatures = [SECP256K1, signer A (the note key), over the canonical sig hash]
frame 0    VERIFY  target pool  validate()
frame 1    SENDER  target pool  spend(d, A, S, payee, amount, changeBlinds)
```

`validate` (frame 0) approves execution and payment only when all of these hold:
- exactly these two frames, with frame 1 a value-free `spend` call to the pool;
- the protocol-verified signer is the note address `A`;
- one nonce key, equal to `noteKey(d, A)`, at sequence 0;
- the worst-case gas cost fits in `d − amount`;
- the mint's BLS signature `S` over `A` verifies with the key for denomination `d`.

It reads only its own code and storage the constructor wrote, so one payment can never
invalidate another pending one.

The nonce key is the nullifier. EIP-8250 consumes it when frame 0 approves, so a second
spend of the same note fails the protocol's nonce check. The pool accepts no other
sequence, and the devnet showed that check is needed
([F3](research/feasibility/f03-single-use-nonce-keys.md)). `spend` never reverts: a failed
payout becomes change, and change becomes a new deposit against fresh blinded points,
which the mint signs like any other.

Deposit, mint and announce follow teecash's `BlindMint`: one BLS12-381 key per
denomination (0.001, 0.01, 0.1, 1 ETH), a mint-chosen split, and a one-rung mint tax.

## Gas, measured

On the devnet, payment `0xe1984cd4…`:

| Part | Gas |
|---|---|
| VERIFY frame (`validate`, BLS pairing + hash-to-G2 + introspection) | 317,451 |
| SENDER frame (`spend`, payout + change deposit) | 89,867 |
| Whole transaction (with intrinsic, calldata and state gas for the change slots and a new payee account) | 928,052 |
| Deposit of 0.123 ETH with 7 blinded points | 306,130 |

The VERIFY frame is over three times the canonical mempool's 100k cap. The staked pool is
what gets it into the alt mempool ([F2](research/feasibility/f02-staked-validation-budget.md)).

At mainnet prices read at 2026-11-07T00:07Z (base fee 0.0360 gwei, ETH $2,234.36 from
Chainlink's ETH/USD feed), the whole payment would cost 928,052 × 0.0360 gwei ≈
0.000033 ETH ≈ **$0.075**. Mainnet prices state gas differently from this devnet, so treat
that figure as indicative.

## Anon-RPC: every call, and its route

| Call | Without Anon-RPC it reveals | Route |
|---|---|---|
| `eth_getLogs` for deposits and announcements | which deposits you care about | Anon-RPC |
| `eth_getStorageAt(NONCE_MANAGER, …)` (is my note spent?) | your exact notes, next to your IP | Anon-RPC |
| `eth_call` (pool keys, deposit state), `eth_chainId`, `eth_gasPrice` | little | Anon-RPC |
| Deposit and faucet `eth_sendRawTransaction` | your IP next to an already public deposit | Anon-RPC |
| Payment `eth_sendFrameTransaction` to Skandha | **your IP on the payment, the link the design exists to cut** | Anon-RPC: over Nox, included (block 11030). Nym drops the header Skandha needs |
| ENS lookup on Sepolia | the name you pay | Anon-RPC |
| Specifier read on mainnet | that this browser loads an anon-rpc worker | **Excluded**: the harness needs it once, before any worker exists |
| Explorer link | opened by you | **Excluded** |
| The CLI | everything | **Excluded**: operator and test tool. The Node harness gives its guest no WebAssembly, so tor-js, Nym and Nox cannot run there |

The app's traffic list shows every call with its route. The route picker includes "direct
(Anon-RPC off)" for the side-by-side comparison.

## Trust

| Party | Can steal? | Can link a payment to a deposit? |
|---|---|---|
| Mint | No; it can refuse to sign. Signing off-band is capped by `totalSpent ≤ totalAnnounced`. | No: it sees only blinded points. Timing is the practical leak. |
| Skandha, ethrex, RPC providers | No | Not by IP, when the route is anonymizing |
| A front-runner | No: the note key signs fees, frames and nonce key | No |
| Chain observer | No | Deposits and payments are public; the link needs the blinding factor, which never leaves the client |

**The mint has not run in a real enclave.** The CRE simulator says itself that it is not a
TEE, and the local mint holds its keys in `.env`. Until the workflow runs in an attested
enclave, the mint is trusted not to sign off-band, exactly as in a classic Chaumian mint.

Known leaks:
- timing between deposit and payment;
- the denomination of each note;
- the payee, which is public by design.

The change mint takes one rung (0.001 ETH) of tax per payment, which is a lot for small
payments. Lowering the rung means another key, and that is a design choice, not a fix.

## CROPS

- **Free and open source:** this repository, under the license below.
- **No trackers:** the app loads only its own bundle and the anon-rpc worker, whose hash is
  pinned on chain.
- **Keys on device:** the seed and the funding key live in the browser's storage. Nothing
  that holds value leaves the device.
- **Recover with nothing from us:** everything derives from the seed. `Restore from seed`
  rebuilds the notes from the chain alone. The CLI demo shows 9 notes restored this way.
- **Privacy at the network layer:** Anon-RPC is on by default, over the Nox mixnet.

## Run it

Needs `node` ≥ 23.6 (it runs the TypeScript directly), `npm`, `forge`, `cast`, `just`,
and `go` plus `cre` for the CRE mint. Built and run with node 26.3, forge 1.8.1, go 1.27.3
and cre 1.32.

```sh
just install
just test                 # forge (with TypeScript vectors over FFI), node:test, tsc, go test
just demo                 # on the devnet: init, deploy, deposit, mint, pay, change, restore
```

The demo creates throwaway devnet keys in `.env` (gitignored) and funds them from the
devnet's shared genesis key, which the EF workshop publishes for that use.

The browser app, against the demo pool:

```sh
just cre-mint             # one terminal: the CRE mint, listening
just app                  # another: http://localhost:5173  (Nox by default)
#                         ?route=tor-js, ?route=nym, ?route=passthrough, ?route=direct
```

The CRE mint (needs `cre login`):

```sh
just deploy-cre                         # a DevnetForwarder and a pool that trusts it
just cre-mint                           # as a service, listening for Deposited logs
just cre-mint-once <tx hash> [log index]   # one deposit, replayed
```

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry. `FramePool.sol`, `FrameOps.sol` (raw-bytecode helpers for APPROVE, TXPARAM, SIGPARAM, FRAMEPARAM, FRAMEDATACOPY, which solc cannot emit), `BLS.sol` |
| `lib/` | TypeScript core, shared by the CLI and the app: blind BLS, seed-derived notes, the frame-tx codec, the wallet client, the mint's split |
| `cli/` | Operator and developer CLI |
| `app/` | Browser wallet on `@anon-rpc/browser-harness` |
| `workflow/` | The CRE mint (Go) |
| `probes/` | One directory per feasibility question, with its result |
| `research/` | The questions, verdicts and verbatim source captures |

## Reuse and prior art

- The BLS code (Solidity, TypeScript, Go) and the deposit/announce contract logic come from
  [teecash](https://github.com/IvanAnishchuk/teecash), which built on
  [nozkash](https://github.com/IvanAnishchuk/NozKash). Same author, same license.
- The frame-tx codec is derived from Skandha's (MIT, Etherspot), as vendored in the
  [EF mempool workshop](https://github.com/forshtat/mempool-workshop). That repo's
  bytecode-helper pattern is what lets stock Solidity use the frame opcodes.
- A pool as the frame-tx sender with nonce-key nullifiers already exists as a stand-in in
  [Skandha's e2e tests](https://github.com/forshtat/mempool-workshop-sidecar), with no
  credential check. framecash adds the BLS verification, binds the nullifier to the note and
  pins the frame list ([P2](research/prior-art/p02-pool-as-frame-sender.md)).

## License

`CC0-1.0 OR Apache-2.0 OR WTFPL`, at your option; see [LICENSE.md](LICENSE.md).
Contributions are inbound = outbound and need a DCO sign-off (`git commit -s`, see
[DCO.md](DCO.md)). I hold no patents and do not intend to acquire any.
