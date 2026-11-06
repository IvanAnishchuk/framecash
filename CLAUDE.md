# CLAUDE.md — framecash

A research repo for a tentative ETHGlobal Mumbai project. Read [`README.md`](README.md)
first, then [`research/README.md`](research/README.md) for what is open.

## What a finished answer looks like

Each question in `research/` ends in one of these verdicts, and only on evidence:
- **works**: shown working by a probe, or stated in a primary source (spec, code,
  release notes), with the exact version or commit;
- **fails**: shown failing, with the error text, and with the fallback the design takes;
- **done before**: prior art found, with a link and what it means for us (reuse it,
  differentiate from it, or drop the idea);
- **unknown**: we looked and couldn't settle it, with what was tried and who to ask
  on site.

"We looked and found nothing" and "we never looked" are different results. Write which
one it is.

## Files

- **Captures** (`research/sources/**`): page or doc text exactly as fetched, under a
  header with the source URL, fetch date and SHA-256 prefix. Never edit or summarise
  them.
- **Analysis** (everything else): says what it is derived from.
- Edit files with the Edit and Write tools. No `sed -i`, heredocs or rewrite scripts.

## Probes

- One directory per question under `probes/`, named `qNN-<slug>/`. Each has a README
  saying what it checks, how to run it, and the result with the date.
- The result goes into the matching `research/feasibility/` file too. A probe whose
  result is only in a terminal didn't happen.
- Probes are throwaway, but keep them runnable: they are the evidence.
- Keys used by probes are throwaway devnet keys, kept in a gitignored `.env`.
