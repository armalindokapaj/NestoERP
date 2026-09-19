# Environments

Per PRD #34 §4-§11, §224, §320.

NESTO runs in three environments. They share no database, no object storage, no
cache namespace and no secret.

| Config | Development | Staging | Production |
|---|---|---|---|
| Database | Local PostgreSQL | Dedicated | Dedicated |
| Object storage | Local filesystem | Private bucket | Private bucket |
| Auth secret | Development value | Staging value | Production value |
| Email | Sink | Sandbox | Real provider |
| CSP | Relaxed (`unsafe-eval` for HMR) | Production-like | Strict |
| Rate limiting | Relaxed | Enabled | Enabled |
| Demo seed | Yes | Synthetic only | **Never** |
| Demo sign-in and demo user switcher | Yes | **No** | **No** |
| Debug logging | Yes | Limited | No |
| Backups | Optional | Short retention | Full policy |

## APP_ENV is the authority

`APP_ENV` is server-authoritative and takes precedence over `NODE_ENV`
(PRD #34 §11, PRD #30 §349). `lib/config/env.ts` validates it at startup and
refuses to boot a production process that is missing a required secret
(PRD #34 §55).

`isDevMode` in `lib/auth/dev-mode.ts` reads `APP_ENV` first, so a staging
deployment built with `NODE_ENV=development` still refuses the demo sign-in and
the demo user switcher. A production build started with `APP_ENV=development`
has them, which is how `tests/e2e/auth/demo-user-switch.spec.ts` runs.

## Required variables

| Variable | Dev | Staging | Production |
|---|---|---|---|
| `DATABASE_URL` | required | required | required |
| `AUTH_SECRET` | optional | required | required |
| `APP_ENV` | optional | required | required |
| `NEXT_PUBLIC_APP_URL` | optional | required | required |
| `STORAGE_DRIVER` | `local` | `s3` | `s3` (`local` is refused) |
| `STORAGE_SCANNER` | `none` | `clamav` | `clamav` (a scanner is required) |
| `LOG_LEVEL` | `debug` | `info` | `info` |
| `MAIL_PROVIDER` | `memory` | `resend` / `postmark` | `resend` / `postmark` (sinks refused) |
| `MAIL_FROM`, `MAIL_API_KEY` | — | required | required |
| `MAIL_ALLOWED_RECIPIENTS` | optional | required | ignored |
| `APP_URL` | optional | required | required |
| `METRICS_TOKEN` | optional | required | required |
| `CLAMAV_HOST` / `CLAMAV_PORT` | — | required with `clamav` | required with `clamav` |
| `NOTIFICATION_BATCH_SIZE`, `SCAN_BATCH_SIZE` | optional | optional | optional |
| `WORKER_RETENTION_APPLY` | — | optional | `true` once retention is signed off |

## Workers

Every environment beyond a laptop runs the worker (`pnpm worker`, see
`worker-operations.md`) against its own database. Staging and production each have
their own workers; a worker never points at another environment's database, bucket,
scanner or mail provider (PRD #38 §103).

`APP_URL` is the origin every emailed link is built from — invitations, reset
links, notification emails. It is configuration, never a request header, so a
spoofed `Host` cannot redirect a link (PRD #38 §162).

## Rate limiting

Sign-in, password reset (request and submission), invitation resend and
invitation acceptance are throttled by `lib/core/security/throttle.ts`, whose
counters live in PostgreSQL (`rate_limit_buckets`) so every instance shares one
count (PRD #38 §17). Each flow is limited per account and per client address.
The client address is the first entry of `X-Forwarded-For`: deploy behind a
proxy or load balancer that sets that header itself and strips any value the
client sent.

Search, uploads and download grants use the in-process limiter in
`lib/core/security/rate-limit.ts`, which is deliberately per-instance.

## Mail

See `docs/runbooks/mail-delivery.md`. Staging must use a sandbox or allowlisted
provider: with `APP_ENV=staging`, a recipient outside `MAIL_ALLOWED_RECIPIENTS`
is recorded as `SUPPRESSED` and never sent (PRD #38 §12).

Secrets never appear in `NEXT_PUBLIC_*`, in the client bundle, in logs or in
this repository (PRD #34 §60).
