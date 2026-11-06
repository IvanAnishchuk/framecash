# framecash

Blind-signature eCash notes that pay their own gas, as EIP-8141 frame transactions.

**Status: tentative research, 2026-10-26.** This is the candidate project for ETHGlobal
Mumbai (Nov 5–7 2026). Nothing is built, and it may still be replaced by something
else. The point of this repo is to learn **before the weekend**:
- whether any part of it has already been done, or already has research we should
  build on;
- whether any part of it is impossible or unreasonable on the tools that will exist at
  the event.

## The idea, short

A depositor gets BLS blind-signed notes from a mint. To pay, the note holder sends a
frame transaction whose sender is the pool contract itself. The pool checks the mint's
signature in its VERIFY frame and pays the gas out of the note, so no relayer and no
funded fresh address are needed. BLS validation (~178k gas) is over the canonical
mempool's 100k cap, so payments go through the ERC-8421 alt mempool with a staked pool.
All RPC traffic goes through Anon-RPC. The mint is a Chainlink CRE Confidential
Workflow, and ENSv2 provides pay-by-name.

Full shape: [`docs/design.md`](docs/design.md).

## Layout

| Path | What |
|---|---|
| [`docs/design.md`](docs/design.md) | The overall shape: protocol, gas, tracks, build order |
| [`research/README.md`](research/README.md) | Tracker: every open question and its status |
| `research/feasibility/` | One file per "can this work at all" question |
| `research/prior-art/` | One file per area where someone may have done it already |
| `research/sources/` | Verbatim captures that findings cite |
| [`probes/`](probes/README.md) | Throwaway scripts that answer a feasibility question |

## License

`CC0-1.0 OR Apache-2.0 OR WTFPL`, at your option; see [LICENSE.md](LICENSE.md).
Contributions are inbound = outbound and need a DCO sign-off (`git commit -s`, see
[DCO.md](DCO.md)). I hold no patents and do not intend to acquire any.
