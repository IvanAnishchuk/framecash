# F2 probe: a staked pool's ~300k validation, admitted

Answers [`research/feasibility/f02-staked-validation-budget.md`](../../research/feasibility/f02-staked-validation-budget.md).

## What it checks

The real thing rather than a gas burner: the CLI demo deploys `FramePool`, which stakes
itself in the devnet's staking registry from its constructor, then sends a one-note payment
whose VERIFY frame runs the whole BLS check. The payment goes to Skandha
(`eth_sendFrameTransaction`), and the probe records whether it is admitted and included, and
what each frame cost.

## Run

```sh
forge build --root contracts
node cli/src/main.ts demo        # init, deploy, deposit, mint, sync, pay, mint change, restore
cast rpc --rpc-url https://altmempool.forshtat.com/rpc skandha_explorer_getTransaction <payment hash>
```

## Result, 2026-11-07: works

ethrex `v23.0.0-eip8141-tracer-9aa3645d`, Skandha `v4.1.1`, chain 1337. Full output in
[`demo-2026-11-07.txt`](demo-2026-11-07.txt), Skandha's admission record in
[`admission-0xe1984cd4.json`](admission-0xe1984cd4.json).

- Pool `0xa6641b28a9e916b985326d9c1a394f3cfd946cfe`, deployed in block 10270 for 24,303,212
  gas (state gas for the stored keys and code), staked 0.012 ETH in
  `0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f`.
- Payment `0xe1984cd46fe86328d09be6ef22dd55bd2aa526a89d5e5f2ab6c7f440973be9c0`: sender and
  payer the pool, mined in block 10277, both frames `success`.
- **VERIFY frame: 317,451 execution gas** (`0x4d80b`) against a 600,000 limit, over three
  times the canonical `MAX_VERIFY_GAS` of 100k. SENDER frame (`spend`): 89,867.
- Skandha's record: `outcome: included`, and every check `pass`, including `prefix`,
  `storage` and `OP-011` for frame 0 with the pool as `payer`.

Not measured: where the staked budget ends. The pool's actual 317k was admitted with a 600k
frame limit; the 250k/900k burner ladder from the plan was not run, since the design's
payload settled the question.
