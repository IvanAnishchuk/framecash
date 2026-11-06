# F11. Can ENSv2 EAC roles be scoped to specific records?

**Verdict:** open

## Why it matters

The non-cosmetic part of the ENS integration is a device key that can update only the
user's receive records, with no other write access to the name.

**If it fails:** the integration falls back to a plain `addr` lookup, which the prize
text calls cosmetic. Then the ENS work is likely skipped.

## How to settle

- Read the Enhanced Access Control contract for the role granularity: per resource, per
  record key, per coin type.
- Grant a test key a role on one record and confirm a write to a different record
  reverts.

## Findings

## Evidence
