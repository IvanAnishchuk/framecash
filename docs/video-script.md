# Demo video: script (about 3 minutes, browser only)

The CRE mint runs in the background (`just cre-mint`) and isn't filmed. Cuts are fine,
speed-ups are not (ETHGlobal rule), so cut out the waits.

## Before recording (off camera)

1. Window A: a fresh Chrome guest window, zoom 125%, open
   https://ivananishchuk.github.io/framecash/ and wait for the green **nox: ready**.
2. In window A, press **Get devnet ETH** and wait for "0.5 devnet ETH sent".
3. Window A, second tab: https://altmempoolexplorer.forshtat.com/, then click **Miner** in
   the left list.
4. Window B: a *different* browser or profile (a second Chrome guest window shares storage
   with the first, which would spoil the restore). Open the same app URL and leave it
   loaded.
5. Copy a payee address to paste, e.g. `0x000000000000000000000000000000000000c0de`.

## Shots

| # | Time | Do | Say |
|---|---|---|---|
| 1 | 0:00 | Window A, top of the app, balance 0. | "This is framecash: private cash that pays its own gas. You deposit from any wallet, get blind-signed notes nobody can link to that deposit, and spend them with no relayer and no gas wallet." |
| 2 | 0:15 | Point at the route pill **nox: ready**. | "Everything this app sends goes through Anon-RPC over the Nox mixnet, so the RPC and the mempool never see my IP." |
| 3 | 0:25 | Press **Add money** (0.023). Wait for "Deposited… Waiting for the mint". *Cut the wait.* "Minted 4 notes", balance 0.022. | "I deposit 0.023 ETH with blinded points. The mint is a Chainlink CRE workflow: it sees the deposit, signs the blinded points in its confidential handler, and writes the signatures back on chain. My wallet unblinds them into four notes." |
| 4 | 0:55 | Paste the payee, amount 0.004, press **Pay**. Wait for "Paid 0.004 ETH" and the **Last payment** line. | "Now I pay. This is one EIP-8141 frame transaction, and its sender is the pool contract itself, not me. The pool checks the mint's BLS signature during validation, pays the gas out of the note, and pays the payee." |
| 5 | 1:20 | Scroll to **Traffic**. Point at `eth_sendFrameTransaction  skandha  nox`. | "Even the payment itself went to the alt mempool over Nox. Every call here, reads included, went through the mixnet." |
| 6 | 1:35 | Copy the hash from **Last payment**. Explorer tab: paste it into "Find a transaction by hash", Enter. Point at Status **On chain**, **Sender** and **Payer** (the same pool address), the **Frame 0 / Frame 1** boxes, and "Every rule passed". | "On the alt-mempool explorer: on chain. Sender and payer are both the pool. Frame 0 verifies and approves paying the gas, frame 1 pays. Its validation needs about 317 thousand gas, three times what the public mempool allows, so the pool is staked and goes through the ERC-8421 alt mempool. Every admission rule passed." |
| 7 | 2:10 | Back to the app. Press **Sync** after a few seconds. Balance about 0.016. | "The change came back as new notes. The CRE workflow picked the change deposit out of the frame transaction and signed it too." |
| 8 | 2:25 | Press **Show my seed**, copy it. Window B: paste into **Restore from seed**, press **Restore**. The notes and balance appear. | "Everything derives from one seed. On a new device I restore from the seed alone, by scanning the chain over the mixnet. No server holds anything." |
| 9 | 2:45 | Window A, or the repo page https://github.com/IvanAnishchuk/framecash. | "Contracts, client, CRE workflow and every probe are open source. The README lists what's proven on the devnet and what isn't. Thanks." |

## If something goes wrong on camera

- **"Waiting for the mint" for more than a minute:** the background mint has stopped.
  Restart it with `just cre-mint`, then press Sync.
- **A payment says Skandha dropped it:** the note is not spent. Press Pay again.
- **The route pill isn't green after 10 s:** reload the page.
