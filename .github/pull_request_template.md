<!--
  Delete the sections that do not apply. Neither the authorization list nor the
  ownership list is optional for anything that reads or writes a business
  record: see docs/security/authorization-model.md (PRD #47 §185) and
  docs/data-ownership.md (PRD #48 §276, §277).
-->

## What this changes

<!-- One or two sentences. Link the PRD sections. -->

## AUD requirements affected

<!-- IDs from docs/dev/aud-test-map.md (e.g. FA-07, TR-12, DX-08), or "none". -->

- [ ] Each affected ID has a test that names it, or the evidence is linked here
- [ ] `docs/dev/aud-test-map.md` regenerated if tests were added or renamed

## Change summary

- [ ] Ownership: which domain owns what this writes; any new cross-domain door or exception (with reason and owner)
- [ ] Permissions: new or changed permission keys, roles, modules or scope rules
- [ ] State: new or changed states, transitions or guards
- [ ] No architecture baseline raised (`scripts/architecture/*.baseline.json`); if one was, why and who owns removing it

## Migration risk

<!-- "No migration", or: what it changes, LOW/MEDIUM/HIGH per docs/runbooks/database-migrations.md -->

- [ ] Additive / expand-contract, safe while the previous release still runs (a push to main applies it)
- [ ] Backfill, NOT NULL, UNIQUE or FK changes checked against existing data; locks and runtime considered
- [ ] Rollback or forward-repair written down; no applied migration edited

## Test evidence

<!-- Commands run and their results. Say what was NOT run and why. -->

## Documentation

- [ ] README / `docs/dev/*` / module docs still true (commands, env vars, destructive flags)

## Refactors only

- [ ] Invariant preserved: <!-- which rule, and the characterization test that proves it -->
- [ ] Callers migrated: <!-- all / list of remaining ones -->
- [ ] Rollback: <!-- revert is safe? any data written in the new shape? -->
- [ ] Not mixed with unrelated feature work

## Authorization

- [ ] Company-scoped — every query starts from `context.companyId`, no lookup by id alone
- [ ] Permission checked with a permission key, never a role name
- [ ] Scope applied at the query source, not by filtering in JavaScript
- [ ] Record access verified through the registry or the module's scope builder
- [ ] State guard — the record's current state allows the action
- [ ] Linked ids verified to belong to the caller's company, and project where it applies
- [ ] No server-owned field (`companyId`, `createdBy…`, `approvedBy…`) accepted from the request
- [ ] Security tests added or extended

## Ownership and transactions

<!-- For any change that writes. Who owns this record? -->

- [ ] The write is by the model's owning domain, or through that owner's door
- [ ] Transaction boundary named — everything that must be true together commits together
- [ ] Rollback behaviour understood: a failure leaves no foreign-domain record behind
- [ ] No irreversible side effect (mail, storage, external API) inside the transaction
- [ ] Idempotency considered — a retry or a double-click makes one record, not two
- [ ] Concurrency considered — a stale edit or a second decision gets a 409, not a silent overwrite
- [ ] Audit and outbox written in the same transaction where the change requires them
- [ ] `docs/data-ownership.md` and `docs/transaction-boundaries.md` still true

## State and history

<!-- For any change that moves a record between states, or touches a document. -->

- [ ] The transition is semantic — an action, not a status the client chose
- [ ] Allowed source states are declared, and the state the caller read is in the `where`
- [ ] Nothing that became history is overwritten: a new version, a correction or a reversal instead
- [ ] A reason is required where the transition demands one
- [ ] Audit emitted for the transition, in the same transaction
- [ ] Document parent authorisation checked — never the file id alone
- [ ] Transition tests added, including the stale and simultaneous cases
- [ ] `docs/state-machines.md`, `docs/document-lifecycle.md` and `docs/audit-model.md` still true

## Identity and sessions

<!-- For any change touching sign-in, accounts, sessions or mail. -->

- [ ] Nothing authenticates by email — `username` is the identifier
- [ ] No flow was made to require mail delivery to complete
- [ ] Passwords and hashes stay out of logs, audit metadata and responses
- [ ] Session-ending events still end sessions (password change, reset, suspension)
- [ ] `docs/authentication-local.md`, `docs/session-security.md` and `docs/account-administration.md` still true

## Checks

- [ ] `pnpm lint` · `pnpm typecheck`
- [ ] `pnpm test` (or the suites this touches)
- [ ] `pnpm verify:authorization` · `pnpm verify:ownership` · `pnpm verify:state` · `pnpm verify:production-guards` · `pnpm security:matrix --check` · `pnpm verify:roles`
- [ ] `pnpm test:security`
- [ ] Migration reviewed against `docs/` and applied with `migrate deploy` (never `migrate dev`)
