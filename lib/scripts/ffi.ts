// FFI entry point for the forge tests. Each command prints one ABI-encoded hex value.
//
//   node scripts/ffi.ts vector  <sk> <dstHex> <addr>               abi(bytes pubkey, bytes sig)
//   node scripts/ffi.ts dst     <chainId> <pool>                   abi(bytes dst)
//   node scripts/ffi.ts notekey <chainId> <pool> <denom> <note>    abi(uint256 key)
//
// `vector` signs through the blind path (blind, blind-sign, unblind), so the Solidity tests
// check the TypeScript pipeline end to end against the contract's verifier.
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { type Hex, encodeAbiParameters, hexToBytes, toHex } from "viem";
import { unblind } from "../src/bls/blind.ts";
import { dst } from "../src/bls/domain.ts";
import { g2ToBytes } from "../src/bls/eip2537.ts";
import { blindSign, mintKey } from "../src/bls/mint.ts";
import { rBytes } from "../src/notes.ts";
import { noteKey } from "../src/pool.ts";

const [cmd, ...args] = process.argv.slice(2);
const out = (types: { type: string }[], values: unknown[]) => process.stdout.write(encodeAbiParameters(types, values));

switch (cmd) {
  case "vector": {
    const [sk, dstHex, addr] = args;
    const key = mintKey(1n, BigInt(sk));
    // An arbitrary tag, so hash to the curve here rather than through a Domain.
    const Y = bls.G2.hashToCurve(hexToBytes(addr as Hex), { DST: hexToBytes(dstHex as Hex) });
    const r = 0x1234567890abcdefn;
    const sig = unblind(blindSign(key, g2ToBytes(Y.multiply(r) as typeof bls.G2.Point.BASE)), rBytes(r));
    out([{ type: "bytes" }, { type: "bytes" }], [toHex(key.pk), toHex(sig)]);
    break;
  }
  case "dst": {
    const [chainId, pool] = args;
    out([{ type: "bytes" }], [toHex(dst({ chainId: Number(chainId), contract: pool }))]);
    break;
  }
  case "notekey": {
    const [chainId, pool, denom, note] = args;
    out([{ type: "uint256" }], [noteKey(Number(chainId), pool as Hex, BigInt(denom), note as Hex)]);
    break;
  }
  default:
    throw new Error(`ffi: unknown command ${cmd}`);
}
