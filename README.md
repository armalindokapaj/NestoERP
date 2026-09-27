# NESTO

A multi-company construction and real-estate ERP: one Next.js application, one
PostgreSQL database (Prisma), one access system and one module shell. Companies
belong to groups. Every record is company-scoped, and every request resolves
the caller's company, role, permissions and module access on the server.

Production: Vercel (`fra1`) beside a Supabase PostgreSQL database. A push to
`main` deploys and applies pending migrations
([release and rollback](docs/dev/release-and-rollback.md)).

## Start here

| I want to… | Read |
|---|---|
| run it locally from a clean checkout | [docs/dev/local-setup.md](docs/dev/local-setup.md) |
| know what an environment variable does, and where it is required | [docs/dev/environment.md](docs/dev/environment.md) |
| know whether a command is safe (read-only / writes / **destructive**) | [docs/dev/commands.md](docs/dev/commands.md) |
| run tests, and know what CI runs | [docs/dev/testing.md](docs/dev/testing.md) |
| find the test for an AUD requirement | [docs/dev/aud-test-map.md](docs/dev/aud-test-map.md) |
| run or debug background jobs | [docs/dev/workers.md](docs/dev/workers.md) |
| trace a user's error (request IDs, error codes) | [docs/dev/troubleshooting.md](docs/dev/troubleshooting.md) |
| ship or roll back | [docs/dev/release-and-rollback.md](docs/dev/release-and-rollback.md) |
| see known duplication/boundary debt | [docs/debt-ledger.md](docs/debt-ledger.md) |

Toolchain: **Node 22** (`.nvmrc`, what CI runs) and **pnpm 9.15.4**
(`packageManager`; `npm install` does not work). PostgreSQL 14+ locally, 16 in CI.

```bash
pnpm install --frozen-lockfile
cp .env.example .env            # set DATABASE_URL (your own database) and AUTH_SECRET
pnpm db:deploy && pnpm db:seed  # migrate, then seed the demo data
pnpm dev                        # http://localhost:3000
```

Never point `DATABASE_URL` at a database someone else uses. Resetting is
**destructive** and guarded: see [commands](docs/dev/commands.md#destructive).

## How the code is organised

The request path is route or server action → context/validation adapter
(`lib/api/respond.ts`, `lib/context`) → the owning domain service in
`lib/modules/<domain>` → a scoped repository or transaction. UI (`app/`,
`components/`) handles presentation and user intent. Nothing under `app/`
writes to the database directly. That rule, one owner per model, and the
state-machine rules are enforced by gates in CI.

| Area | Where | Reference |
|---|---|---|
| Domains | `lib/modules/*` (projects, tasks, clients, documents, finance, hr, sales, procurement, contracts, inventory, qaqc, hse, calendar, meetings, approvals, timesheets, daily-logs, engineering, contractors, project-3d, …) | [docs/data-ownership.md](docs/data-ownership.md), [docs/domain-dependencies.md](docs/domain-dependencies.md) |
| Access and isolation | `config/{access,permissions,role-defaults}.ts`, `lib/access`, `lib/context` | [docs/security/authorization-model.md](docs/security/authorization-model.md), [docs/security/api-security-matrix.md](docs/security/api-security-matrix.md) |
| Transactions and state | `lib/core`, `scripts/architecture/*` | [docs/transaction-boundaries.md](docs/transaction-boundaries.md), [docs/state-machines.md](docs/state-machines.md), [docs/audit-model.md](docs/audit-model.md) |
| Workers | `lib/core/jobs`, `scripts/worker.ts` | [docs/workers.md](docs/workers.md), [docs/worker-matrix.md](docs/worker-matrix.md) |
| Data model | `prisma/schema.prisma`, `prisma/migrations` | [docs/data-model.md](docs/data-model.md), [docs/runbooks/database-migrations.md](docs/runbooks/database-migrations.md) |
| Environments | `lib/config/env.ts`, `lib/auth/dev-mode.ts` | [docs/environments.md](docs/environments.md) |
| Demo data | `prisma/seed`, `prisma/seed/armaar` | [docs/demo-armaar.md](docs/demo-armaar.md) |
| Decisions | | [docs/adr/](docs/adr/) |
| UX, tables, forms, mobile, accessibility, performance | | [docs/ux/](docs/ux/), [docs/tables/](docs/tables/), [docs/forms/](docs/forms/), [docs/mobile/](docs/mobile/), [docs/a11y/](docs/a11y/), [docs/perf/](docs/perf/) |
| Operations | | [docs/runbooks/](docs/runbooks/) |
| Design system, shell, public-site reasoning (historical) | `styles/tokens.css`, `components/ui`, `components/layout` | [docs/dev/architecture-notes.md](docs/dev/architecture-notes.md) |

## Status

What is built, tested and still open is recorded in
[docs/release-readiness.md](docs/release-readiness.md) and
[docs/gap-audit.md](docs/gap-audit.md). The AUD-01..AUD-12 audit programme is
in progress. Its requirements and their tests are mapped in
[docs/dev/aud-test-map.md](docs/dev/aud-test-map.md). A requirement is
complete only when its evidence is recorded, not because a document or script
exists.

## Contributing

Use the pull-request checklist in
[.github/pull_request_template.md](.github/pull_request_template.md). Keep
refactors small, behaviour-preserving and separate from feature work.
Migrations are applied with `prisma migrate deploy`, never `migrate dev`, `db
push` or a reset, on any shared database.
