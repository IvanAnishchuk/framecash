# Frame-tx eCash: blind-signature notes that pay their own gas

<!-- DESIGN. Derived from the ERC-8421, EIP-8141, EIP-8250 and EIP-2537 specs and
     the ETHGlobal Mumbai prize text (2026-10-22). Written 2026-10-24; updated 2026-11-07
     where the build and the probes changed it (marked "as built" or "measured"). The
     frontend is a web app (app/). Open questions live in research/README.md, not here. -->

## 1. The idea in three sentences

You deposit ETH from a normal wallet. A mint blind-signs a set of note keys, and you get
back notes that nobody can link to the deposit. To pay, you send a **frame transaction
whose sender is the pool itself**: the pool checks the mint's BLS signature during
validation, approves paying the gas, and pays the merchant from the note. You never need
a funded fresh address, and no relayer is involved.

All reads and sends go through **Anon-RPC**, so the RPC provider and the alt-mempool node
also can't link the deposit to the payment through the user's IP.

### Properties

- **Who submits a payment:** the note holder, as a frame tx with the pool as sender.
- **Who pays gas:** the pool, with the fee taken from the note inside the same tx.
- **Where the funds land:** straight at the payee, with change re-deposited in the same
  tx. No fresh wallet ever holds funds.
- **Double-spend check:** an EIP-8250 nonce key at sequence 0, consumed by the protocol;
  the pool accepts no other sequence (F3: the single-use form is not live on the devnet).
- **Network privacy:** Anon-RPC for every read and send.
- **Mint:** a CRE Confidential Workflow in simulation, against the devnet (§6).

## 2. Tracks and the one-prize rule

> "One EF prize per project. You can submit to anon-rpc, the alt mempool and CROPS, but
> you will be placed in at most one. EF judges decide where it fits best."

The goal is to qualify **strongly** for both tracks and let the judges place it. CROPS
qualification costs one README section and the rules below, so it is worth meeting too.

Sponsor picks, up to three:
- **EF** counts as one sponsor whatever tracks are entered.
- **ENS** is the second: a low-effort integration, see §11.
- **Chainlink** is the third. The mint is a CRE Confidential Workflow, run with
  `cre workflow simulate`; simulation qualifies for the prize. We drop it only if
  simulation against the devnet proves impossible (§9).

| Track | Qualification | How this design meets it |
|---|---|---|
| Alt mempool | "a link to your admitted transaction on the devnet explorer, or code that submits one"; team explains design and trade-offs | Every payment is an admitted alt-mempool tx with a staked pool sender. The track's own example (a) asks for ">100k verification budget … privacy protocols" |
| Anon-RPC | "Your app routes its RPC reads through Anon-RPC by default" | All reads by default, plus sends. Exclusions are listed in §5 as deliberate trade-offs, which the track says is fine |
| CROPS (optional) | FOSS repo, a `CROPS` README section, no trackers, keys on device | Recovery from the seed alone (§3.5), no relayer, and Anon-RPC covers the P property |
| Chainlink: Best workflow with CRE ($1.5k) | Build, simulate or deploy a workflow used as an orchestration layer. It must "integrate at least one blockchain with an external API, system, data source, LLM, or AI agent". A CLI simulation is enough | The mint is the workflow: deposit log trigger → blind-sign inside the confidential handler → `announce`. The external-system leg is an open question (§9) |
| ENS: Best Use of ENSv2 ($7k) | ENSv2 on mainnet or Sepolia, "central to the product, not a cosmetic add-on", a live demo, open source | Pay by name, with receive slots in a per-name Permissioned Resolver (§11) |

## 3. Protocol

### 3.1 Parties

- **Pool contract.** It holds deposits, publishes announcements, and is the
  `tx.sender` of every payment. It is staked in the ERC-8421 Staking Registry. The mint
  public keys are immutable, compiled into its code.
- **Mint.** It watches deposits and blind-signs, with one BLS12-381 key per
  denomination on a fixed ladder. Signing is all it does; it holds no funds.
- **Client.** It holds one seed. Every note key and blinding factor derives from that
  seed.

### 3.2 Add money: deposit and mint (canonical mempool, ordinary txs)

1. The client derives note keys `a_i` with addresses `A_i`, and blinding scalars `r_i`,
   from the seed and a counter.
2. It computes `B_i = r_i · H_to_G2(A_i)` and sends `deposit([B_1..B_N])` with value X.
3. The mint answers with `announce(depositId, [S'_i], [denom_i])`, where
   `S'_i = sk_d · B_i`.
4. The client unblinds, `S_i = r_i⁻¹ · S'_i`, and checks each `S_i` against `pk_d`. A note
   is `(a_i, d_i, S_i)`.

### 3.3 Pay: one frame tx with the pool as sender (alt mempool)

The fields:
- `sender = pool`
- `nonce_keys = [k]` with `k = keccak256(abi.encode(NOTE_TAG, chainid, pool, d, A))`, and
  `nonce_seq = 0`. The protocol moves the key to 1 when frame 0 approves, and the pool
  accepts only 0, so the note is spent once. *(As built. The draft used EIP-8250's
  single-use form `MAX_NONCE_SEQ`; Skandha rejects it today, see F3. `FramePool.noteSeq` is
  an immutable, so a later pool can switch.)*
- `signatures = [SECP256K1 by a]`: the note key signs the canonical sig hash.

| # | Mode | Target | What it does |
|---|---|---|---|
| 0 | VERIFY `self_verify` | pool | See the checks below. Then `APPROVE` with scope execution + payment |
| 1 | SENDER | pool | `spend(d, A, payee, amount, changeBlinds[])`: pay `amount` to `payee`, keep the fee, and record the remainder as a new deposit against `changeBlinds` |

The checks in frame 0:
- The protocol-verified signer (`SIGPARAM`) is `A`.
- `TXPARAM(0x0E) == 1`, `TXPARAM(0x10) == k`, and `TXPARAM(0x01) == noteSeq` (0). EIP-8250
  says single-use keys MUST be authenticated this way, and F3 showed that without the
  sequence check a consumed key can be used again at sequence 1.
- The frame list is exactly `[self_verify, spend(...)]`, and frame 1's data names
  `(d, A)`.
- `e(pk_d, H_to_G2(A)) == e(G1, S)`.
- The maximum fee is less than `d − amount`, so the note covers the worst-case gas.

**Why the note key signs.** It's a cheap secp256k1 check that the protocol already runs.
The sig hash covers the fees, the frames and the nonce keys. A mempool node or a
front-runner therefore can't redirect the payment, inflate the fee to drain the pool, or
add keys.

**The fee comes from the note.** The `spend` frame computes the change as
`d − amount − max_fee × gas_limit`. The gas the tx doesn't use stays in the pool.
Whether to refund it to the payer instead is an open choice.

**The `spend` frame must never revert.** The nonce key is consumed and gas is charged
when frame 0 approves, so a revert would burn the note while the pool still pays. Every
transfer is therefore a low-level call. A failed payout turns into change instead of a
revert.

**Change goes back through the mint.** The remainder becomes a deposit in the same tx,
the mint announces signatures for `changeBlinds`, and the client unblinds as in §3.2.
This is what makes arbitrary amounts usable without a fresh wallet ever holding funds.

**Paying with several notes (stretch goal).** Use up to k nonce keys and verify with an
aggregate pairing over k+1 pairs. The estimate for k = 8 is about 880k: under the staked
1M. See §4.

### 3.4 What an observer sees

- **Deposits:** a visible wallet deposits X.
- **Payments:** the pool pays a payee, and every payment shows the same sender.
- **Each payment reveals** the note address `A` and its denomination.
- **The link to a deposit** would need `r_i`, which never leaves the client.

The known leaks:
- timing, solved by spacing payments on the client;
- denomination fingerprints, solved by the ladder plus batching;
- the payee's identity, which is public by design (§10's receive slots hide it).

### 3.5 Recovery

Everything derives from the seed: the `a_i`, `r_i` and change keys. The `S'_i` are in
announce events on chain. A new device rebuilds the notes from the seed plus a chain scan
over Anon-RPC. It needs nothing from the operator, which covers CROPS's "recover with
nothing from you" idea directly.

## 4. Gas and why the alt mempool is required

**Measured on the devnet (2026-11-07, F2):** the VERIFY frame used 317,451 gas, the SENDER
frame 89,867, and the whole payment 928,052, including state gas. The estimate below
missed the helper calls, the frame-data decoding and the BLS code's byte-copy loops. It is
kept as the reasoning:

| Validation item | Gas |
|---|---|
| Pairing, 2 pairs | 102,900 |
| Hash-to-G2 (2 × `MAP_FP2_TO_G2` + `G2ADD` + SHA-256 + `MODEXP`) | ~50,000 |
| secp256k1 signature, protocol-validated, counted toward the cap | ~3,000 |
| Single-use nonce key | ~20,000 |
| Introspection glue | ~2,000 |
| **One note** | **~178,000** |
| k notes, aggregated: `32,600(k+1) + 37,700 + 48,200k + 20,000k + …` | k = 8: ~880k |

**What it would cost on mainnet.** Prices read live on 2026-10-24: base fee 0.043 gwei
plus a tip of about 0.006 gwei, so about 0.05 gwei, with ETH at $2,367.
- One-note payment, about 270k gas in total: **$0.03**.
- Eight-note payment, about 1M gas: **$0.12**, about 1.5¢ per note.

Aggregation is cheaper per note. The limit on it is the 1M budget, not cost.

This is over the canonical 100k, under the 1M for a staked entity. The pool reads only
its own code, and the mint keys are immutable, so there is no foreign storage read. The
gas budget is the only canonical rule it breaks.

**The pool stays ACTIVE.** Reputation punishes mass invalidation. Three things could
invalidate a pending payment:
1. **The same note key being consumed.** That needs the signature of `a`, so only the
   owner can do it, one note at a time.
2. **The pool's balance falling.** Node-side solvency reservations handle this, and
   balances only fall through payments the node already tracks.
3. **A mint key change.** The keys are immutable. Rotation means a new pool with a new
   stake.

No root ring buffer exists, so the vector Wahrstätter describes doesn't apply.

**Optional demo for the track's "break the rules" item:** deploy a deliberately naive
pool whose mint key lives in mutable storage. Flood it, rotate the key, and show it
getting THROTTLED and then BANNED for real, not through the debug shortcut the workshop
uses.

## 5. Anon-RPC: a map of every call

The judging asks "how much of the app's traffic goes through Anon-RPC" and welcomes
deliberate exclusions. The target is all of it.

| Call | What it reveals without Anon-RPC | Route |
|---|---|---|
| Scanning `Deposit`/`Announce` logs | Which deposits you care about | Anon-RPC |
| `eth_getStorageAt(NONCE_MANAGER, slot(pool, k))` for "is my note spent?" | **Your exact notes**, linked to your IP | Anon-RPC |
| Pool balance, fee estimate | Little | Anon-RPC |
| Deposit tx (`eth_sendRawTransaction`) | Your IP next to a deposit that's already public | Anon-RPC, so one IP isn't seen on both sides |
| Payment tx (`eth_sendFrameTransaction` to the Skandha gateway) | **Your IP on the payment, which is the link the whole design exists to cut** | Anon-RPC |
| Mint API, if any | None if signatures arrive only through `announce` on chain | Not needed |
| Explorer links in the UI | Opened by the user | Excluded, and stated |

**Why it matters, in one line for the demo:** if one RPC provider sees the deposit and
the payment from the same IP, the blind signature hides nothing.

Facts to settle early:
- **The harness is browser-only** (`@anon-rpc/browser-harness`). A web app or extension
  can use it as is. A native app would need a new harness, which is itself one of the
  track's idea-list items.
- **Can it reach the devnet?** The live devnet is `altmempool.forshtat.com` (ethrex) and
  `/rpc` (Skandha); the `*.altmempool.wtf` hosts did not answer. Nym reaches it for reads
  and deposits. The payment send over Nym fails, because the worker drops `content-type`.
  tor-js's demo gateway was down (F8, F9).

## 6. The mint

**The mint is a CRE Confidential Workflow, run in simulation against the devnet:**
1. An EVM log trigger fires on `Deposit`.
2. Inside the confidential handler, the workflow signs `S'_i = sk_d · B_i`.
3. Outside the enclave again, the workflow calls `GenerateReport`, then `WriteReport`,
   which delivers `announce`.

The handler also signs the change deposits from §3.3, which arrive through the same
`Deposit` event.

**What's known about running against chain 1337:**
- Chain 1337 is in chain-selectors as `geth-testnet`, selector `3379446385462418246`.
- `cre workflow simulate --allow-unknown-chains` skips the chain-name check. It still
  requires a selector and an RPC, so log triggers and reads should work against the
  devnet.
- In simulation, `WriteReport` goes through a mock forwarder for each chain, and none is
  known for 1337. This is unverified; see §9.

**Trust.** The simulator says plainly that it isn't a real TEE.
Until the workflow is deployed to an attested enclave, the mint is trusted not to sign
off-band. `totalClaimed ≤ totalAnnounced` bounds the damage, and the README must say so.

**Fallback, only if simulation against the devnet proves impossible:** the same signing
code as a plain local service that calls `announce` from the mint key.

**Upgrade, not planned for the event:** a t-of-n threshold mint. Blind BLS is linear, so
the partial signatures combine into `S'` with no change to the verifier.

## 7. Frontend form: constraints only, not a choice

- Anon-RPC's browser harness favours a web app or an extension today.
- Notes and the seed live client-side. An extension's storage and lifecycle handle that
  better than a tab. A web app needs careful IndexedDB handling plus export.
- A native app needs a harness of its own. That's more work, but it fits the Anon-RPC
  track's "new harness" item.
- The UX target is the same in every form: **a balance, "Add money", "Pay" (an address
  or QR code plus an amount), "Restore from seed"**. No notes, denominations or nonce
  keys are shown unless asked for.

## 8. What makes it look ready

- **One demo path:** add money, then wait for the mint, then pay a QR code with change,
  then restore on a second device.
- **On screen:** the admitted tx on `altmempoolexplorer.forshtat.com`, the pool's
  staking and ACTIVE status, and a live Anon-RPC indicator showing the circuit or route
  for each call.
- **A side-by-side** of what the RPC provider sees with Anon-RPC on and off.
- **A README** with the `CROPS` section, the gas table from §4 as measured numbers, and
  the trust table from §3.4 and §6.

## 9. Open questions

Tracked in [`research/README.md`](../research/README.md): feasibility questions F1–F11
and prior-art areas P1–P7.

## 10. ENS: pay by name (low effort)

ENS won't likely pay, but a small integration that uses ENSv2 itself costs little.
ENSv2 runs on Sepolia and the pool on devnet 1337. ENS only carries data here, so the
two chains never interact.

**Baseline:**
- A parent name on Sepolia with its own Permissioned Registry. Each user gets
  `alice.<parent>.eth` with a Permissioned Resolver of their own.
- Enhanced Access Control grants the user's device key a role limited to their receive
  records. The parent keeps no write access to them.
- A record `addr(coinType 0x80000539)` holds the devnet payee address.
- The app's "Pay" accepts a name, resolves it over Anon-RPC, and pays as in §3.3.

**Stretch: receive slots, so the payee gets notes instead of revealing an address.**
- The resolver holds a text record listing pre-blinded points `B_j`, which the payee
  computes from their seed.
- The payer's `spend` frame sends `amount` as a deposit against the payee's `B_j`, not to
  an address.
- The mint signs. The payee unblinds and now holds notes. No payee address is ever on
  chain.
- The payee's device refills used slots through its EAC role. That's the ENSv2 feature
  carrying real weight.
- Open: F10 and F11.

**Why this should count as ENSv2-central rather than cosmetic:**
- per-name Permissioned Resolvers;
- EAC roles scoped to a record;
- a subname registry under our own rules.

Plain `addr` lookup alone would be cosmetic.

## 11. Rough build order

ETHGlobal's from-scratch rule allows design and research beforehand. The code gets
written at the event.

1. Pool contract with BLS verify. Measure the gas locally, then on the devnet with one
   admitted payment.
2. TS client library: derivation, blinding, building and signing frame txs, all over
   Anon-RPC from the first call.
3. Mint as a CRE workflow in simulation, then the change-with-mint loop.
4. UI and the demo path from §8.
5. ENS baseline (§11).
6. Stretch goals:
   - ENS receive slots;
   - multi-note payments;
   - the naive-pool reputation demo.
