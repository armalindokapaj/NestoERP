# Local setup

From a clean checkout to a signed-in demo. Each step lists what must be true
before you run it and what you should see afterwards.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node | **22** (`.nvmrc`, the version CI runs). Node 24 is used on the maintainer's machine but is not what CI tests. | runtime |
| pnpm | **9.15.4** (`package.json` `packageManager`). With Corepack: `corepack enable`. | `npm install` does not work in this repo |
| PostgreSQL | 16 in CI. Any 14+ server you control locally. | data |

## Steps

1. **Install**
   ```bash
   nvm use            # or any way of getting Node 22
   pnpm install --frozen-lockfile
   ```
   - *Before:* the prerequisites above.
   - *After:* `node_modules/` exists, and `postinstall` has run `prisma generate` (a "Generated Prisma Client" line). The command fails if the lockfile is out of date. Do not "fix" that by dropping the flag.

2. **Configure**
   ```bash
   cp .env.example .env
   # set DATABASE_URL to a local database of your own, and AUTH_SECRET:
   openssl rand -base64 32
   ```
   - *After:* `.env` holds `DATABASE_URL`, `AUTH_SECRET`, `NESTO_DEMO_PASSWORD` and `STORAGE_DRIVER=local`. See [environment.md](environment.md) for every variable.

3. **Create an isolated database and migrate**
   ```bash
   createdb nesto_dev
   pnpm db:deploy
   ```
   - *Before:* `DATABASE_URL` names that database. Do not point it at a database somebody else uses.
   - *After:* "All migrations have been successfully applied." `db:deploy` never resets or drops anything.

4. **Seed the test fixtures** (development and test databases only)
   ```bash
   pnpm db:seed
   ```
   - *Before:* a migrated database. The seed refuses production/staging environments and remote databases not named in `NESTO_SEED_TARGET` (`prisma/seed/guard.ts`, `lib/core/database/target.ts`).
   - *After:* the seed builds the fixture groups and validates them. A validation failure exits non-zero.

5. **Verify the seed** (read-only)
   ```bash
   pnpm verify:organization
   ```
   - *After:* both exit 0.

6. **Start the app**
   ```bash
   pnpm dev            # http://localhost:3000, always port 3000
   ```
   - *After:* the public site loads. Sign in with a seeded username and `NESTO_DEMO_PASSWORD`. In development the sign-in page lists the demo accounts.

7. **Start the worker** (only if you need background work: notifications, scans, retention)
   ```bash
   pnpm worker --validate      # registry and environment, then exit
   pnpm worker --once          # one pass over due jobs
   ```
   See [workers.md](workers.md).

8. **Smoke test**
   - Sign in, open Projects, open a project and change something permitted, for example a task's status. Reload and check that the change persisted.
   - Sign in as a role without Finance and open `/finance`. You should be refused.
   - Automated: `pnpm test:e2e` (Playwright, which starts or reuses a server on 3000). Do not run it at the same time as `pnpm test`, because both use the same database ([testing.md](testing.md)).

## Starting again from scratch (**DESTRUCTIVE**)

```bash
NESTO_DISPOSABLE_DATABASES=nesto_dev pnpm db:reset:demo
```

This drops everything in `nesto_dev`, re-migrates and re-seeds it. It refuses
before running anything if the database is remote, not listed in
`NESTO_DISPOSABLE_DATABASES`, or the environment says production/staging, and
at a terminal it asks you to type the database name. See [commands.md](commands.md).

## Limitations

- These steps are written from the scripts and CI. A run on a truly clean
  machine (DX-06) has not been recorded yet.
- Mail defaults to the in-memory sink, so nothing is delivered. Storage is the
  local filesystem under `.storage/`, and scanning is off (`STORAGE_SCANNER=none`
  records `NOT_REQUIRED`, not `CLEAN`).
- 3D basemap features need `NEXT_PUBLIC_MAPBOX_TOKEN`. Without it, only the
  Mapbox-backed parts are disabled.
