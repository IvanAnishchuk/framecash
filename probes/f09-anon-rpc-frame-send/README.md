# F9 probe: `eth_sendFrameTransaction` through Anon-RPC

Answers [`research/feasibility/f09-anon-rpc-frame-send.md`](../../research/feasibility/f09-anon-rpc-frame-send.md).

## What it checks

The app's Pay button sends the payment frame tx to Skandha
(`https://altmempool.forshtat.com/rpc`, `eth_sendFrameTransaction`) through whichever
Anon-RPC route is selected. Same setup as [the F8 probe](../f08-anon-rpc-reaches-devnet/README.md).

## Result, 2026-11-07: the harness passes it; the Nym worker breaks it

| Route | What happened |
|---|---|
| Nym | Skandha answered `-32600 Unsupported Media Type: undefined`. The request reached Skandha without its `content-type` header. |
| passthrough (harness + sandbox, plain fetch) | Admitted. First try `0xab545266…48b9bd1` was admitted and then dropped by Skandha ("relayed 4 times without being included in a block"); the retry `0x3fbd0b7edc1ed8a7be8794cda05ccd64cef00c88e6b4f977d3ed14be43e530cd` was included in block 10430, payer the pool. |
| tor-js | Not reached: the demo gateway is down (F8). |

- The harness has no method allowlist: the passthrough run sends the new method through the
  same sandbox and call queue the anonymizing workers use.
- The harness forwards headers: `@anon-rpc/browser-harness` 0.4.0 `dist/host.js` lines
  243–253 serialize them, `content-type` included. So the Nym worker, or its exit (an IP
  Packet Router), drops them. ethrex tolerates a missing `content-type`, which is why every
  read and the deposit went through over Nym; Skandha does not.
- The dropped first attempt left the note unspent (its nonce key was never consumed). A
  CLI payment sent right after it was included at once (block 10406), so the drop came from
  the devnet, not from the route. The app now polls `skandha_frameTransactionStatus` and says
  when Skandha drops a payment.

What would close it, in order of effort: a tor-js gateway that works (then retest); a fix
in the Nym worker to forward request headers (report to Nym); or Skandha accepting JSON
bodies without `content-type`.
