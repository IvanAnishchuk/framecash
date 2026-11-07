# F7. What satisfies CRE's "external API/system" requirement?

**Verdict:** unknown (2026-11-07). The wording is now confirmed for Mumbai; whether a
chain-to-chain mint meets it is Chainlink's call.

## Why it matters

The prize asks for a workflow that "integrates at least one blockchain with an external
API, system, data source, LLM, or AI agent". A chain-to-chain mint may not meet that.

**If it fails:** the workflow needs a real off-chain leg. One candidate also improves
privacy: clients submit blinded points over the HTTP trigger instead of in the public
deposit tx, so the deposit only carries an amount.

## How to settle

- Read the Mumbai prize text and judging notes for the exact wording.
- Check past CRE prize winners for what judges accepted as the external leg.
- Ask Chainlink whether an HTTP trigger fed by our own client counts.

## Findings

- The Mumbai prize page was "Prize details coming soon" for Chainlink on 2026-10-22 (the
  hackathon notes' capture). It is now published, and the design's wording, which came from
  the ETHOnline brief, holds word for word. "Best workflow with CRE", $1,500. The workflow
  should:
  > Integrate at least one blockchain with an external API, system, data source, LLM, or AI agent.
  > Demonstrate a successful simulation (via the CRE CLI) or a live deployment on the CRE network.
  > Be meaningfully used in your project

  and "It is NOT mandatory to deploy it during the hackathon, simulation is enough!"
- The workflow as built is a log trigger, signing in the confidential handler with keys
  from the Vault DON, and a report write back to the same chain. Its off-chain parts are
  the Vault DON secrets and the TEE. Whether those count as an "external system" is not
  something the text settles.
- Not looked at: past CRE prize winners. Not asked yet: Chainlink.

**Recommendation.** Ask Chainlink at the booth with the workflow running. If the answer is
no, the cheapest real external leg that also helps privacy is the HTTP trigger from the
original plan. Clients post blinded points to the workflow instead of putting them in the
deposit tx, so the deposit carries only an amount. That changes `deposit`'s calldata and
the mint's input, so decide it before the demo is recorded.

## Evidence

- Capture: [`research/sources/ethglobal.com-mumbai-prizes.md`](../sources/ethglobal.com-mumbai-prizes.md),
  fetched 2026-11-07, sha256 `7b9ca5d3ba709fd4`.
