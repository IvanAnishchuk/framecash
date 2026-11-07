# F5 and F6 probe: the CRE mint on chain 1337

Answers [`f05-cre-write-to-1337.md`](../../research/feasibility/f05-cre-write-to-1337.md) and
[`f06-cre-log-trigger-frame-blocks.md`](../../research/feasibility/f06-cre-log-trigger-frame-blocks.md).

## What it checks

`cre workflow simulate --broadcast` runs the mint workflow on a real devnet deposit: log
trigger, signing in the confidential handler, `GenerateReport`, and `WriteReport` to the pool.
Then the same on the change deposit that `spend` emits **inside a frame transaction**.

## Run

```sh
just deploy-cre                       # DevnetForwarder + a pool that trusts it
# put both addresses in workflow/project.yaml and workflow/blindmint/config.devnet.json
just deposit 0.123
just cre-mint-once <deposit tx>       # F5
just sync && just pay <payee> 0.004
just cre-mint-once <payment tx> 1     # F6: log 1 of a payment is the change deposit
just sync
```

## How chain 1337 gets a forwarder

The CLI (v1.32.0) lists no forwarder for chain 1337. A `rpcs:` entry for it is dropped
("no RPC URLs found for target"), even with `--allow-unknown-chains`. The working form is
the CLI's `experimental-chains` section, which takes `chain-type`, `chain-selector`,
`rpc-url` and `forwarder`. These keys don't appear in `cre --help`; they were read off the
binary's settings structs. The forwarder is `contracts/src/DevnetForwarder.sol`: the
Keystone `report(address,bytes,bytes,bytes[])` entry point, the same 109-byte metadata split,
and no signature check, like the mock. The real `MockKeystoneForwarder 1.0.0` (on Sepolia at
`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`) keeps an owner and a forwarder allowlist in
storage, so copying its runtime alone would not work.

The CLI also reads `project.yaml` from the working directory rather than from `-R`, so
the recipes run inside `workflow/`.

## Result, 2026-11-07: both work

CRE CLI v1.32.0, ethrex `v23.0.0-eip8141-tracer-9aa3645d`, chain 1337.

- Forwarder `0x88e93b8df54523b7d45807ec592c99cf6c576ec8`; pool
  `0x27c0e726879c4703d6cef2da49db818ba0abd007` (block 10704, staked 0.012 ETH).
- **F5:** deposit `0x9e5df24621191427341d09e6ea19c340d2c4d0da4b93e85d1db56fd3836b477c`
  answered with "signed 5 notes for deposit 1". Report written by
  `0x582972cface2bc936e1b09489cd46dc837ab57620ca0fa371f1c4d9e9be73668` (block 10730). The
  wallet unblinded 0.1 + 2×0.01 + 2×0.001 ETH and verified every signature.
- **F6:** payment `0x134935cb0851a887ed9d5ae9fe7e11bc1d8727e984d994fb9f47715ecdf26545`
  (block 10745, sender and payer the pool). The trigger decoded the change `Deposited` from
  inside that frame tx, "signed 4 notes for deposit 2", and wrote them in
  `0xd25ab340e8e3f5ff3c57042713ab0ee0ff588d298841f3af4d50d98072e274e5` (block 10750). No
  local mint was running.

- **F6, live:** with `just cre-mint` listening from block 10770, payment
  `0x9bc3d4b21182515fb17001623d7c5e4337a8e9b921f5259db47c068d87f23258` (block 10784) fired
  the trigger on its own: "signed 5 notes for deposit 3", written by
  `0x4a84b5f372514d608347a4abd4b22b0da74ef9ddc882df925bd1cd484c7d622b` (block 10785).

Outputs: [`simulate-deposit-2026-11-07.txt`](simulate-deposit-2026-11-07.txt),
[`simulate-change-in-frame-tx-2026-11-07.txt`](simulate-change-in-frame-tx-2026-11-07.txt),
[`listen-2026-11-07.txt`](listen-2026-11-07.txt) (excerpt as written while it ran).

Trust note: the DevnetForwarder checks no DON signatures, so on this devnet anyone can
deliver a report to the CRE pool. That is the simulator's own model (its mock checks none
either) and acceptable on a throwaway chain only. A deployment needs CRE's real forwarder,
which CRE has to support on the chain.
