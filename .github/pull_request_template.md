<!--
  Delete the sections that do not apply. The authorization list is not optional
  for anything that reads or writes a business record: see
  docs/security/authorization-model.md (PRD #47 §185).
-->

## What this changes

<!-- One or two sentences. Link the PRD sections. -->

## Authorization

- [ ] Company-scoped — every query starts from `context.companyId`, no lookup by id alone
- [ ] Permission checked with a permission key, never a role name
- [ ] Scope applied at the query source, not by filtering in JavaScript
- [ ] Record access verified through the registry or the module's scope builder
- [ ] State guard — the record's current state allows the action
- [ ] Linked ids verified to belong to the caller's company, and project where it applies
- [ ] No server-owned field (`companyId`, `createdBy…`, `approvedBy…`) accepted from the request
- [ ] Security tests added or extended

## Checks

- [ ] `pnpm lint` · `pnpm typecheck`
- [ ] `pnpm test` (or the suites this touches)
- [ ] `pnpm verify:authorization` · `pnpm security:matrix --check` · `pnpm verify:roles`
- [ ] `pnpm test:security`
- [ ] Migration reviewed against `docs/` and applied with `migrate deploy` (never `migrate dev`)
