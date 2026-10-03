# Commands

Every `package.json` script, grouped by what it does to data. "Writes" means
the script changes a database, storage or external state. **DESTRUCTIVE** means
it can delete data that it did not create, and such commands run only against a
validated disposable target.

The destructive guards live in `lib/core/database/target.ts` and
`scripts/db/destructive.ts`. Before anything runs, they refuse a remote
database, a database not named in `NESTO_DISPOSABLE_DATABASES`, and any
environment that says production or staging (`APP_ENV`, `VERCEL_ENV`,
`NODE_ENV`). At a terminal they then ask you to type the database name. In CI
they need `CI=true` and `NESTO_CONFIRM_DESTRUCTIVE=<database>`.

## Read-only

| Command | Preconditions | Expected result |
|---|---|---|
| `pnpm lint` | installed | ESLint exits 0 |
| `pnpm typecheck` | installed (`NODE_OPTIONS=--max-old-space-size=8192` helps on large runs) | `tsc --noEmit` exits 0 |
| `pnpm verify:authorization` · `verify:ownership` · `verify:state` · `verify:workers` · `verify:production-guards` | installed | static gates. They exit 0 or name the file and rule |
| `pnpm check:client-bundle` | installed | static scan of client import chains. It exits 0 or prints each chain |
| `pnpm security:matrix --check` · `security:access-manifest:check` | installed | fail when `docs/security/*` is stale |
| `pnpm verify:company-integrity` · `verify:organization` · `verify:employment` · `verify:employee-integrity` · `verify:workflows` | `DATABASE_URL` points at a seeded database | read queries only. They exit 0 or list findings |
| `pnpm worker --validate` · `--status` · `--failures` · `--health` | `DATABASE_URL` for status/failures | print, no job runs |
| `pnpm db:studio` | database | opens Prisma Studio, which can edit rows if you use it to |

## Writes files, not data

| Command | Result |
|---|---|
| `pnpm security:matrix` · `security:access-manifest` | regenerate `docs/security/api-security-matrix.md` / `access-manifest.json` |
| `pnpm verify:ownership --update-baseline` · `verify:state --update-baseline` | re-record architecture baselines. Only after review. Never to turn a failing change green (see `docs/debt-ledger.md` L-06) |
| `pnpm build` · `pnpm test:e2e:prod` | `.next/` or `.next-e2e/`. Never build into `.next` while `pnpm dev` runs |

## Writes data (non-destructive)

| Command | Preconditions | What it writes |
|---|---|---|
| `pnpm dev` · `pnpm start` | migrated database | sessions and whatever you do in the app |
| `pnpm db:deploy` | `DATABASE_URL` | applies pending migrations. It never resets, pushes or seeds |
| `pnpm db:seed` | migrated database, and seed guard passes | demo companies, people and records, then validates them. Refuses production/staging and unnamed remote databases |
| `pnpm access:sync` | database | roles, permissions and the module matrix from `config/`. Safe in every environment |
| `pnpm company:bootstrap` | database, `access:sync` done | a new company and its owner invite |
| `pnpm verify:roles` | a running server on 3000 | signs in as every persona over HTTP, which creates sessions |
| `pnpm worker` · `worker --once` · `worker --run=<job>` | database | runs jobs: notifications, scans, cleanup, retention (reports only unless `WORKER_RETENTION_APPLY=true`) |
| `pnpm worker --retry-failed --operator=<name>` | database | requeues FAILED outbox events |
| `pnpm notifications:dispatch` | database | dispatches the outbox. Sends mail if a real provider is configured |
| `pnpm storage:maintenance` | database, storage | **Not a pure dry run.** It really runs the scan job (records verdicts) and the usage reconcile (rebuilds the projection). Cleanup and orphans are dry runs. It deletes nothing without `--apply` |
| `pnpm retention:dry-run` | database | runs the retention job through its lease and reports what it would delete |
| `pnpm repair:employment` | database | a dry run by default (lists drift). `--apply` rewrites current employment fields and audits them |

## DESTRUCTIVE

| Command | Guard | Result |
|---|---|---|
| **`pnpm db:reset:demo`** | disposable local target, typed confirmation | drops everything, re-migrates, re-seeds |
| **`pnpm db:migrate`** | same guard | `prisma migrate dev`, which can reset. For authoring migrations in a disposable database only. See [../runbooks/database-migrations.md](../runbooks/database-migrations.md) |
| **`pnpm db:push`** | same guard | `prisma db push`. Never a repair for drift on a shared database |
| **`pnpm db:drift`** | `SHADOW_DATABASE_URL` distinct from every application URL, local and disposable | creates and drops a run database beside the shadow. It never touches `DATABASE_URL` |
| **`pnpm perf:d10`** | disposable local target, never `nesto_erp` | adds tenfold synthetic records to every company |
| **`pnpm storage:maintenance:apply`** | production also needs `--environment=production` | expires abandoned upload sessions and removes their objects |
| **`tsx scripts/retention.ts --apply --confirm=DELETE`** | explicit confirmation | deletes records past retention |
| **`pnpm test:security:links`** | refuses a development database | writes through every write endpoint. CI's throwaway database only |

## Tests

The opt-in release tests `aud12-migration-replay` and `aud12-seed-rerun` create and drop their own `nesto_a12_*` databases on `AUD12_PG_SERVER`. They are safe to run beside other work but need `CREATEDB` ([testing.md](testing.md)).

See [testing.md](testing.md). Every `test:*` suite except `test:unit` reads
and writes the database in `DATABASE_URL`, and suites put back what they change.
Never point them at a database you care about.
