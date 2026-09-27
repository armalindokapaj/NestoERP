# Environment variables

Derived from the code (`process.env` reads, `lib/config/env.ts`,
`lib/core/jobs/worker.env.ts`, `lib/core/database/target.ts`, the storage
factory and `scripts/`). Deployment-class rules (what staging and production
need) are also in [../environments.md](../environments.md), and
[`.env.example`](../../.env.example) has comments for each group.

**Exposure.** Only `NEXT_PUBLIC_*` variables reach the browser, and they are
compiled into the bundle at build time. Everything else is server-only. Never
put a secret in a `NEXT_PUBLIC_*` variable.

**Validation.** `lib/config/env.ts` validates the core set with zod and reports
*which* rule failed, never the value. The worker validates its own variables
(`pnpm worker --validate`) and refuses to start on a bad value. Destructive DB
commands validate their target before running anything.

Legend: **R** required · **O** optional · **—** not used / must not be set.

## Core

| Variable | Purpose | Dev/test | Hosted demo (`APP_ENV=demo`) | Staging | Production |
|---|---|---|---|---|---|
| `DATABASE_URL` | Application database. On Vercel, a non-Postgres value falls back to `POSTGRES_PRISMA_URL` (`lib/database/prisma.ts`). | R | R | R | R |
| `DIRECT_URL`, `POSTGRES_URL_NON_POOLING` | Session (non-pooled) URL for migrations. The Vercel build uses `POSTGRES_URL_NON_POOLING`. | O | O | O | O |
| `POSTGRES_PRISMA_URL`, `POSTGRES_URL` | Set by the Supabase integration and counted as application databases by the safety checks. | — | O | O | O |
| `AUTH_SECRET` (or legacy `NEXTAUTH_SECRET`) | Session signing. | O | R | R | R |
| `AUTH_TRUST_HOST` | Auth.js host trust. | O | O | O | O |
| `APP_ENV` | Server-side authority: `development`, `test`, `demo`, `staging` or `production`. It takes precedence over `NODE_ENV`. | O | R (`demo`) | R | R |
| `NODE_ENV` | Set by Next/tooling. | auto | auto | auto | auto |
| `NEXT_PUBLIC_APP_URL` | Public origin (client-visible). | O | R | R | R |
| `NEXT_PUBLIC_SITE_URL` | Origin for metadata, sitemap and robots (client-visible). | O | O | O | O |
| `APP_URL` | Origin for emailed links, never taken from the Host header. | O | O | R | R |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `fatal`. | O | O | O | O |
| `METRICS_TOKEN` | Bearer for the metrics endpoint (at least 24 characters). | O | O | R | R |
| `MAINTENANCE_MODE`, `NESTO_MAINTENANCE_PAGE_CACHE` | Platform maintenance switch and page cache. | O | O | O | O |
| `REDIS_URL` | Accepted by validation. No reader was found in `lib/`. | — | — | — | — |
| `NEXT_PUBLIC_RELEASE_VERSION` | Release label shown by `pnpm worker --status` (client-visible). | O | O | O | O |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Public, origin-restricted Mapbox browser token for 3D basemaps. Never a secret token. | O | O | O | O |

## Demo and seed

| Variable | Purpose | Dev/test | Demo | Staging | Production |
|---|---|---|---|---|---|
| `NESTO_DEMO_PASSWORD` | Password for the seeded accounts. Test-only credential. | R to seed | R to seed | — | **must not be set** |
| `ARMAAR_DEMO_PASSWORD` | Password for the ARMAAR tenant's accounts (seed). | O | O | — | — |
| `NESTO_DEMO_MODE` | Legacy opt-in for demo sign-in on a production Node build without `APP_ENV`. Ignored when `APP_ENV` is production or staging (`lib/auth/dev-mode.ts`). | O | O | — | — |
| `ALLOW_DEMO_SEED` | Required with `NODE_ENV=production` before the seed runs. | — | build sets it | — | — |
| `NESTO_SEED_ON_BUILD` | `1` lets the Vercel build seed an empty, eligible database (`scripts/vercel-build.sh`). | — | O | — | — |
| `NESTO_SEED_TARGET` | `host/database` of the one remote database a seed may write to. | O | R with seed-on-build | — | — |

## Database safety (tooling only)

| Variable | Purpose | Where |
|---|---|---|
| `NESTO_DISPOSABLE_DATABASES` | Comma list of local databases that destructive commands (`db:reset:demo`, `db:migrate`, `db:push`), the drift check and `perf:d10` may destroy. | dev, CI |
| `SHADOW_DATABASE_URL` | The drift check's own shadow. It must be distinct from every application URL. | dev, CI |
| `NESTO_CONFIRM_DESTRUCTIVE` | Non-interactive confirmation (database name), accepted only with `CI=true`. | CI |
| `CI` | Marks CI. Changes Playwright retries/reuse and allows the non-interactive confirmation. | CI |

## Storage and scanning

| Variable | Purpose | Dev/test | Staging/Production |
|---|---|---|---|
| `STORAGE_DRIVER` | `local`, `s3` or `supabase`. | `local` | `s3` or `supabase` (`local` refused) |
| `DOCUMENT_STORAGE_ROOT` | Local driver directory (default `.storage`). | O | — |
| `STORAGE_URL_SECRET` | Signs short-lived download URLs. Falls back to `AUTH_SECRET`. | O | O |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_SESSION_TOKEN`, `STORAGE_FORCE_PATH_STYLE` | S3 driver. Server-only secrets. | — | R for `s3` |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), `SUPABASE_STORAGE_URL`, `NEXT_PUBLIC_SUPABASE_URL` | Supabase driver. Keys are server-only. | — | R for `supabase` |
| `STORAGE_SCANNER` | `none`, `eicar` or `clamav`. | `none` | `clamav` (`eicar` refused in production) |
| `STORAGE_SCANNER_REQUIRED` | `false` lets staging/production start without a scanner. | — | O |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | clamd connection. | — | R with `clamav` |
| `PROJECT_3D_PROCESSING` | `worker` or `inline` model preparation. | O | O |

## Mail

| Variable | Purpose | Dev/test | Staging | Production |
|---|---|---|---|---|
| `MAIL_DELIVERY` | `disabled` means no mail at all, on purpose (everything is recorded SUPPRESSED). | O | O | O |
| `MAIL_PROVIDER` | `memory`, `console`, `resend` or `postmark`. | `memory` | real provider or disabled | real provider or disabled (sinks refused) |
| `MAIL_FROM`, `MAIL_API_KEY` | Provider credentials. | — | R with a real provider | R with a real provider |
| `MAIL_API_URL`, `MAIL_POSTMARK_STREAM` | Provider endpoint override and Postmark stream. | O | O | O |
| `MAIL_ALLOWED_RECIPIENTS` | Staging allowlist. Everyone else is SUPPRESSED. | — | R with a real provider | ignored |
| `TEAM_INVITE_EXPIRY_DAYS` | Invitation lifetime (default 7). | O | O | O |

## Workers (`lib/core/jobs/worker.env.ts`)

| Variable | Purpose |
|---|---|
| `NOTIFICATION_BATCH_SIZE`, `SCAN_BATCH_SIZE` | Batch sizes, 1–1000. Anything else refuses startup. |
| `WORKER_RETENTION_APPLY` | `true` lets retention delete. Otherwise it only reports. |
| `WORKER_DISABLED_JOBS` | Registry keys this deployment does not run. An unknown key refuses startup. |
| `WORKER_SHUTDOWN_TIMEOUT_SECONDS` | Grace period on stop (5–600). |

## Test and diagnostics only

| Variable | Purpose |
|---|---|
| `E2E_PORT`, `E2E_BASE_URL`, `BASE_URL`, `NEXT_DIST_DIR` | Point Playwright/role walk at another server or build directory (`test:e2e:prod` uses `.next-e2e` on 3100). |
| `E2E_ALL_BROWSERS`, `E2E_AUD04_BROWSERS` | Add Firefox/WebKit/mobile projects. |
| `SECURITY_DESTRUCTIVE` | Set by `test:security:links`, which refuses a non-disposable database. |
| `NESTO_PERF_SQL_COUNT` | Per-request SQL statement counting. Never honoured on Vercel or in production/staging. |
| `NESTO_NAV_TELEMETRY`, `NESTO_NAV_TELEMETRY_SAMPLE`, `NESTO_TEST_SHELL_DELAYS` | Navigation measurement and test delays. `verify:production-guards` checks that delays are off in production. |
| `VERCEL`, `VERCEL_ENV`, `NEXT_RUNTIME` | Set by the platform. `VERCEL_ENV=production` counts as production for database safety. |
