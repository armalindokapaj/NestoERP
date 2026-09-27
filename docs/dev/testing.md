# Testing

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| Unit | `pnpm test:unit` | nothing | pure logic: access matrix, resolvers, validation, money and state rules |
| Integration | `pnpm test:integration` | seeded DB | context, scope, isolation and services against real PostgreSQL |
| API | `pnpm test:api` | seeded DB | route handlers through the real service layer, per role |
| Security | `pnpm test:security` | seeded DB | company/project isolation and disabled modules across routes and actions |
| Architecture | `pnpm test:architecture` | nothing | ownership, state, worker and import rules as named tests |
| Transactions / state | `pnpm test:transactions` · `pnpm test:state` | seeded DB | rollback, idempotency and concurrent writers |
| Auth | `pnpm test:auth` | seeded DB | username sign-in, temporary passwords, throttling |
| Workers | `pnpm test:workers` | seeded DB | leases, retries, per-job contracts |
| All vitest | `pnpm test` | seeded DB | everything above |
| E2E | `pnpm test:e2e` | seeded DB, server on 3000 (started or reused) | browser journeys, Chromium |
| E2E, production build | `pnpm test:e2e:prod` | seeded DB | builds into `.next-e2e`, serves on 3100. Safe beside `pnpm dev` |
| E2E, all browsers | `pnpm test:e2e:all-browsers` | as E2E | adds Firefox, WebKit, mobile Safari |
| Cross-company links | `pnpm test:security:links` | **throwaway DB only** | writes through every write endpoint. Destructive |
| Client bundle boundary | `pnpm check:client-bundle` | nothing | no client module reaches the DB layer, Node built-ins or server secrets (DX-04) |
| Migration replay/upgrade (opt-in) | `AUD12_MIGRATION_REPLAY=1 AUD12_PG_SERVER=postgresql://user@localhost:5432 npx vitest run tests/integration/aud12-migration-replay.test.ts` | a Postgres server where you may create databases | creates and drops `nesto_a12_replay`/`nesto_a12_upgrade`. It never touches `DATABASE_URL` (DX-09) |
| Seed rerun (opt-in) | `AUD12_SEED_RERUN=1 AUD12_PG_SERVER=… npx vitest run tests/integration/aud12-seed-rerun.test.ts` | same | seeds twice into its own `nesto_a12_*` database (DX-10) |
| Role walk | `pnpm verify:roles` | running server | every persona over HTTP |

## Rules

- **One database, one suite at a time.** Vitest and Playwright share
  `DATABASE_URL`. Do not run them concurrently, and do not seed or restart the
  server while a Playwright run is going.
- Authorisation is never mocked in a test that verifies authorisation. Tests
  resolve a real session through the real resolver.
- Suites that change seeded state put it back. A failed cleanup must fail the
  run, not be swallowed (AUD-12 §6).
- To run against an isolated database:
  `DATABASE_URL="postgresql://localhost:5432/<your_db>?schema=public" npx vitest run <files>`.
  Create it with `createdb`, then `pnpm db:deploy` and `pnpm db:seed`.

## CI (`.github/workflows/ci.yml`)

| Job | Gates |
|---|---|
| `static` | frozen install, lint, typecheck, `pnpm check:client-bundle` |
| `verify` | drift check (own shadow DB), fresh migration replay, seed, unit, integration, API, authorisation/security/ownership/state/worker gates, architecture, transactions, auth, state, workers, build, production guards, storage maintenance, E2E (Chromium), cross-company links, then the integrity verifiers |
| `release` (push to `main` and manual dispatch only) | `aud12-migration-replay` (empty replay and upgrade of a populated older schema) and `aud12-seed-rerun`, in their own `nesto_a12_*` databases on a disposable server |
| `security` | `pnpm audit --audit-level high`, gitleaks (full history), CodeQL |

Every job uses the Node version in `.nvmrc` and the pnpm version in
`package.json` `packageManager`. Playwright reports and traces are uploaded only
on failure, with 7-day retention.

**Not in CI today:** all-browser/responsive runs, migration upgrade from a
AUD-07 performance measurements
(opt-in, `docs/perf/`, `docs/runbooks/performance-and-stability.md`), and
`verify:roles` (it needs a running server). They are release-validation steps.
Record them in `docs/release-readiness.md` when run. Requiring a check in
branch protection is a repository setting that this file does not prove.

## Which AUD requirement is tested where

[aud-test-map.md](aud-test-map.md).
