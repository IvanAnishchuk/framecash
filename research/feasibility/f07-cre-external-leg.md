# F7. What satisfies CRE's "external API/system" requirement?

**Verdict:** open

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

## Evidence
