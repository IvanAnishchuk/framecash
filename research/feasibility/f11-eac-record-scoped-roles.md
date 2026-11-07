# F11. Can ENSv2 EAC roles be scoped to specific records?

**Verdict:** works, per the primary source (ENS docs, 2026-11-07), with a caveat that
shapes the design: roles scope per record key, not per name. Not yet shown on chain.

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

- Permissioned Resolver: "Each record type has its own role. A role is always held at a
  resource: either `ROOT_RESOURCE` … or the resource of a setter argument such as a text key
  or coin type. … which is how a single `ROLE_SET_TEXT` bit can be restricted to one
  specific key." `grantSetterRoles(setter, account)` grants it from example setter calldata.
  The docs' own example authorizes "a payment service to change Bitcoin addresses without
  allowing it to change Ethereum addresses or avatars". That is exactly the design's device
  key on `addr(0x80000539)` plus a receive-slots text key.
- The caveat: "There is no per-name scoping: a role holder can write the covered records on
  **every** name served by the resolver instance." In ENSv2 "each account gets its own
  resolver instance", so the design's one Permissioned Resolver per user is required, not
  optional. A shared resolver would let any user's device key overwrite everyone's slots.
- Subnames that use the parent's resolver hold no roles on it (`setText` reverts with
  `EACUnauthorizedAccountRoles`), which again points at a resolver per user.

Not done: granting a test key one coin type and seeing a write to another revert. That needs
a funded Sepolia name (F10).

## Evidence

- Capture: [`research/sources/docs.ens.domains-llms-full.md`](../sources/docs.ens.domains-llms-full.md)
  (Permissioned Resolver: Roles, Delegating a Single Text Key; App Developers: subnames).
