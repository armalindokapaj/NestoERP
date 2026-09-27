# Troubleshooting: request IDs and error codes

## Request IDs

Every API response goes through `lib/api/respond.ts` and carries
`x-request-id` and a correlation-id header (`lib/core/observability/request-context.ts`).
Error bodies include the same id:

```json
{ "error": { "code": "CONFLICT", "message": "…", "requestId": "…", "category": "…", "fieldErrors": { } } }
```

When somebody reports a problem, ask for the `requestId`, then search the
server logs for it. The structured logger (`lib/core/observability/logger.ts`)
writes it on every line for that request. Messages are sanitised: no SQL,
stack traces or permission internals reach the client. 401/403/404 refusals
omit `category` and `fieldErrors`, so they never describe a record the caller
may not see.

## Error codes (`lib/access/guards.ts`)

| Code | HTTP | Usually means |
|---|---|---|
| `UNAUTHENTICATED` | 401 | no or expired session. Sign in again |
| `MEMBERSHIP_INACTIVE` / `COMPANY_INACTIVE` | 403 | the account's membership or company is suspended |
| `FORBIDDEN` | 403 | missing permission key or scope |
| `MODULE_UNAVAILABLE` | 403 | the module is disabled for the company |
| `WORKSPACE_COMPANY_REQUIRED` | 409 | a company-only endpoint was called from the Group workspace. Pick a company |
| `NOT_FOUND` | 404 | does not exist **or** is outside your scope (deliberately indistinguishable) |
| `VALIDATION_ERROR` | 422 | see `fieldErrors`, keyed by field path |
| `CONFLICT` | 409 | stale version or state already moved. Reload and retry (AUD-02/AUD-03 conflict review) |
| `PRECONDITION_REQUIRED` | 428 | a version/precondition header was expected |
| `TEMPORARILY_UNAVAILABLE` | 503 | maintenance mode or a dependency is down |
| `INTERNAL_ERROR` | 500 | a bug. Find the `requestId` in the logs |

## Common local problems

| Symptom | Cause and fix |
|---|---|
| `npm install` fails | use pnpm 9 (`corepack enable`) |
| `Invalid environment configuration: …` at start | `lib/config/env.ts` names the rule. See [environment.md](environment.md) |
| Seed refuses | production/staging env, or a remote DB not named in `NESTO_SEED_TARGET` |
| `db:reset:demo` refuses | the database is not local or not in `NESTO_DISPOSABLE_DATABASES`. This is by design |
| `db:drift` refuses | `SHADOW_DATABASE_URL` unset or equal to an application database. Create `nesto_shadow` |
| Next moved off port 3000 / "port in use" | the scripts pin `-p 3000` so this fails loudly. Stop the other server |
| E2E flakes with odd data | another suite or a seed ran against the same DB at the same time |
| Build in `.next` breaks a running dev server | use `pnpm test:e2e:prod` (`.next-e2e`) instead |
| Worker refuses to start | an unknown key in `WORKER_DISABLED_JOBS` or a batch size out of range |

Further reading: [../runbooks/](../runbooks/) (incidents, mail, scanning,
performance and stability).
