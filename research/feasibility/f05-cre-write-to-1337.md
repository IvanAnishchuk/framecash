# F5. Can a CRE simulation write to chain 1337?

**Verdict:** open. Blocked on 2026-11-07: the CRE CLI's login has expired and every
command, `simulate` included, stops at credential validation.

## Why it matters

The mint delivers `announce` through `WriteReport`. In simulation, writes go through a
mock forwarder deployed per chain. Chain 1337 is in chain-selectors as `geth-testnet`
(selector `3379446385462418246`), and `--allow-unknown-chains` skips the name check, but
no mock forwarder is known for 1337.

**If it fails:** the workflow signs, and a small sidecar submits `announce` with a plain
key. Whether that still counts as the workflow being "meaningfully used" for the
Chainlink prize needs an answer from Chainlink; if not, the track drops.

## How to settle

- Read the CRE CLI source for how simulation resolves the forwarder address per chain,
  and whether a config override exists.
- Deploy the mock forwarder ourselves on the devnet if its bytecode is public, and point
  the simulation at it.
- Run `cre workflow simulate` against the devnet with a trivial write.
- Ask in the Chainlink hackathon channel whether a sidecar-submitted write qualifies.

## Findings

Tried, and could not run (2026-11-07, CRE CLI v1.32.0):

```
✗ Credential validation failed
✗ authentication required: credential validation failed: authentication failed: unable to
  retrieve organization info. … token refresh failed: auth response: 403 Forbidden
```

What is ready, so the run is one command after `cre login`:
- `workflow/` holds the mint workflow, ported from teecash with no logic change (the event,
  ledger and report layouts are identical). Host tests pass, and the wasip1 build compiles.
- `workflow/project.yaml` targets `geth-testnet` (chain 1337) at the devnet RPC, and
  `config.devnet.json` names the demo pool. `node cli/src/main.ts workflow-env` writes the
  same four mint keys the local mint uses into `workflow/.env`.
- The command: `just cre-mint-once <deposit tx>`. Its output answers this question: the
  simulator either names a forwarder for 1337 or fails at `WriteReport`.

Still to decide after that run: the demo pool's `forwarder` is the mint EOA (the local mint
announces directly). A CRE write lands through a forwarder contract, so a pool for the CRE
path is deployed with `forwarder` = whatever address the simulation writes from.

## Evidence

- `cre workflow simulate … -T devnet-settings --allow-unknown-chains` output above, on the
  `blindmint` workflow at this commit.
