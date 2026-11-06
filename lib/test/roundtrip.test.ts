import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverAddress } from "viem";
import { unblind } from "../src/bls/blind.ts";
import { fromHex } from "../src/bls/eip2537.ts";
import { mintKey } from "../src/bls/mint.ts";
import { verify } from "../src/bls/verify.ts";
import { type PoolInfo, type Wallet, planDeposit } from "../src/client.ts";
import { sigHash } from "../src/frametx.ts";
import { ETH, LADDER, RUNG, mintable, split } from "../src/ladder.ts";
import { answer } from "../src/mintsvc.ts";
import { noteSecret, rBytes } from "../src/notes.ts";
import { buildPayment, noteKey } from "../src/pool.ts";

const POOL = "0x1111111111111111111111111111111111111111" as const;
const keys = LADDER.map((d, i) => mintKey(d, 1000n + BigInt(i)));
const pool: PoolInfo = {
  address: POOL,
  chainId: 1337,
  noteSeq: 0n,
  rung: RUNG,
  pubkeys: new Map(keys.map((k) => [k.denom.toString(), k.pk])),
  fromBlock: 0n,
};

test("ladder: tax is one rung, splits are exact", () => {
  assert.equal(mintable(ETH / 1000n), 0n);
  assert.equal(mintable((ETH * 123n) / 1000n), (ETH * 122n) / 1000n);
  assert.deepEqual(split((ETH * 12n) / 1000n), [ETH / 100n, ETH / 1000n, ETH / 1000n]);
});

test("seed derivation is deterministic", () => {
  const seed = "0x" + "ab".repeat(32);
  assert.deepEqual(noteSecret(seed as `0x${string}`, 7), noteSecret(seed as `0x${string}`, 7));
  assert.notEqual(noteSecret(seed as `0x${string}`, 7).address, noteSecret(seed as `0x${string}`, 8).address);
});

test("deposit -> mint -> unblind -> verify -> signed payment", async () => {
  const wallet: Wallet = { seed: ("0x" + "cd".repeat(32)) as `0x${string}`, next: 0, notes: [] };
  const amount = (ETH * 12n) / 1000n; // mints 0.011: one 0.01 and one 0.001
  const points = planDeposit(wallet, pool, amount);
  const ann = answer(1n, amount, points, keys, RUNG);
  assert.ok(ann);
  assert.deepEqual(ann.denoms, [ETH / 100n, ETH / 1000n]);

  const i = Number(ann.pointIndexes[0]);
  const secret = noteSecret(wallet.seed, i);
  const sig = unblind(fromHex(ann.blindSigs[0]), rBytes(secret.r));
  assert.ok(verify(pool.pubkeys.get(ann.denoms[0].toString())!, secret.address, sig, { chainId: 1337, contract: POOL }));

  const tx = await buildPayment({
    chainId: 1337,
    pool: POOL,
    note: { key: secret.key, address: secret.address, denom: ann.denoms[0], sig: `0x${Buffer.from(sig).toString("hex")}` },
    payee: "0x000000000000000000000000000000000000cafe",
    amount: ETH / 200n,
    changeBlinds: [],
    noteSeq: 0n,
    maxFeePerGas: 2_000_000n,
  });
  assert.equal(tx.sender, POOL);
  assert.deepEqual(tx.nonceKeys, [noteKey(1337, POOL, ann.denoms[0], secret.address)]);
  const sigBytes = tx.signatures[0].signature;
  const v = Number.parseInt(sigBytes.slice(2, 4), 16);
  const recovered = await recoverAddress({ hash: sigHash(tx), signature: `0x${sigBytes.slice(4)}${(v + 27).toString(16)}` });
  assert.equal(recovered, secret.address);
});

test("mint refuses a deposit with too few points", () => {
  assert.equal(answer(1n, (ETH * 12n) / 1000n, ["0x00"], keys, RUNG), null);
});
