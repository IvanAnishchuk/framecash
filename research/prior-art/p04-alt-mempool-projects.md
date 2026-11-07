# P4. Projects and demos already on the ERC-8421 alt mempool

**Verdict:** partly looked at (2026-11-07). What the EF team has shown is known; the
explorer's other staked entities were not surveyed.

## What we need to know

What has already been admitted on the devnet, especially anything using the large
staked validation budget or doing privacy. Also what the EF team has already shown,
so the demo doesn't repeat it.

## Where to look

- The devnet explorer: staked entities and their txs.
- The EF mempool workshop repo and its findings document.
- Earlier hackathons with an alt-mempool or frame-tx track.

## Findings

- The EF workshop (https://github.com/forshtat/mempool-workshop at `902673eb`) shows:
  - a canonical-vs-alt rejection, a staked wallet and a storage-rule relaxation;
  - reputation, set through a debug shortcut, which its README calls "cheating";
  - the raw-bytecode helper pattern for APPROVE and SIGPARAM, which framecash reuses (F4).

  It never exercises the large per-entity gas budget. framecash's 317k VERIFY frame does
  (F2).
- The sidecar's shared-sender pool test is the closest privacy demo (P2). It runs on a
  local mining devnet in CI, not as a deployed app.
- Not surveyed: other staked entities on the explorer
  (`skandha_explorer_listReputation`), and earlier frame-tx hackathon tracks.

## Evidence

- Workshop `docs/findings.md` and README at the commit above.
