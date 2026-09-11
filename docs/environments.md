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
| DEV role switcher | Yes | **No** | **No** |
| Debug logging | Yes | Limited | No |
| Backups | Optional | Short retention | Full policy |

## APP_ENV is the authority

`APP_ENV` is server-authoritative and takes precedence over `NODE_ENV`
(PRD #34 §11, PRD #30 §349). `lib/config/env.ts` validates it at startup and
refuses to boot a production process that is missing a required secret
(PRD #34 §55).

`isDevMode` in `lib/auth/dev-role.ts` reads `APP_ENV` first, so a staging
deployment built with `NODE_ENV=development` still refuses the role switcher.

## Required variables

| Variable | Dev | Staging | Production |
|---|---|---|---|
| `DATABASE_URL` | required | required | required |
| `AUTH_SECRET` | optional | required | required |
| `APP_ENV` | optional | required | required |
| `NEXT_PUBLIC_APP_URL` | optional | required | required |
| `STORAGE_DRIVER` | `local` | `s3` | `s3` (`local` is refused) |
| `LOG_LEVEL` | `debug` | `info` | `info` |

Secrets never appear in `NEXT_PUBLIC_*`, in the client bundle, in logs or in
this repository (PRD #34 §60).
