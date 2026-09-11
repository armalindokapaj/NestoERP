# Database migration runbook

Per PRD #34 §65-§91, §318, PRD #37 §171-§188.

## Risk classification

| Level | Examples | Requirements |
|---|---|---|
| LOW | New nullable column, new table, small index | Review only |
| MEDIUM | Index on a large table, new FK, enum change | Review + staging rehearsal |
| HIGH | Type rewrite, large backfill, drop column, destructive cleanup | Backup verified, staging rehearsal, timing estimate, documented forward-fix plan |

## Rules

- `prisma migrate deploy` only. Never `migrate dev` or `db push` against a
  deployed database (PRD #34 §67, §68).
- Backfill is separate from schema change, batched and restartable
  (PRD #34 §80-§82, PRD #37 §181).
- Expand → deploy compatible code → backfill → switch reads → contract later
  (PRD #34 §76, PRD #37 §182).
- Never drop a column the currently-deployed version still reads (PRD #34 §78).
- An applied migration is never rewritten; write a new one (PRD #34 §206).

## Worked example in this repository

`20260911150000_finance_settings_deduplication_prd_24` moves three columns from
`finance_settings` to `company_settings`. It backfills first and contracts
second, in that order, and leaves an already-configured company untouched —
which is why it is hand-written rather than generated.

## Before a HIGH-risk migration

- [ ] Latest backup verified and recent
- [ ] PITR healthy
- [ ] Rehearsed against a production-like copy, with timing recorded
- [ ] Lock analysis done — will it block writes, and for how long?
- [ ] Forward-fix plan written down

## Drift

CI runs `pnpm db:drift`. A schema edited without a matching migration fails the
build rather than surprising production (PRD #34 §204, PRD #37 §177).
