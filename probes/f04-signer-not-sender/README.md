# F4 probe: signer that isn't the sender, from stock Solidity

Answers [`research/feasibility/f04-signer-not-sender.md`](../../research/feasibility/f04-signer-not-sender.md).

## What it checks

1. A contract compiled by stock `solc` 0.8.28 can use the EIP-8141 opcodes, which Solidity
   has no syntax for, through raw-bytecode helpers it deploys in its constructor:
   `APPROVE` (`0xaa`, by delegatecall), `TXPARAM` (`0xb0`) and `SIGPARAM` (`0xb4`), both by
   staticcall.
2. A frame tx with `sender` = that contract and one SECP256K1 signature entry whose
   `signer` is a different key (the "owner") is admitted by Skandha and mined. The
   VERIFY frame approves only when `SIGPARAM(0, 0)` returns the owner.
3. What the helpers return inside the tx, logged by the SENDER frame: the resolved signer,
   `nonce_seq`, the nonce key count, nonce key 0 and the canonical sig hash.

## Run

```sh
npm install
npm run probe        # forge build, then tsx probe.ts
```

Needs `forge`. Keys are throwaway devnet keys, generated into a gitignored `.env` on the
first run. The deployer is funded from the devnet's shared genesis key, which the workshop
repo publishes for exactly that use. `ETHREX_URL` and `SKANDHA_URL` override the endpoints.

## Result, 2026-11-07: works

ethrex `v23.0.0-eip8141-tracer-9aa3645d`, Skandha `v4.1.1`, chain 1337
(`https://altmempool.forshtat.com`, `/rpc`).

```
probe   0x108e002cec71fab73beba358fd469ba7bbb4adc1 owner 0xAAE84291A7D1c9241d6d3745CB8846d270dc7CB4
sent    0x8ad3590b2f5bb5ae19714a1afeeb870a2b52ec7c26fbd1a43abf6f60b3428bde (matches local hash)
status  0x1 frames 0x1,0x1 block 10041 payer 0x108e002cec71fab73beba358fd469ba7bbb4adc1
PASS SIGPARAM signer == owner (not sender)
PASS TXPARAM(0x01) nonce_seq == 0
PASS TXPARAM(0x0E) key count == 1
PASS TXPARAM(0x10) key0 == our key
PASS TXPARAM(0x08) == local sig hash
```

Explorer: <https://altmempoolexplorer.forshtat.com/> (search the tx hash).

Found on the way: a plain transfer to a new account costs ~205k gas on this devnet
(new-account state gas). With a 21k limit ethrex rejects it as "Account does not have
enough balance to cover the tx cost", which names the wrong cause.
