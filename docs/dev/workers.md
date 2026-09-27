# Background workers (short version)

All background work is a job in `lib/core/jobs/job.registry.ts`, run by
`pnpm worker` (`scripts/worker.ts`). Web instances never run jobs, and no HTTP
endpoint starts one.

| Command | Effect |
|---|---|
| `pnpm worker --validate` | check the registry and worker environment, then exit (read-only) |
| `pnpm worker --once [--group=…] [--job=…]` | one pass over due jobs (development). **Writes** |
| `pnpm worker` | run every group until stopped. **Writes** |
| `pnpm worker --run=<job> [--dry-run]` | run one job now, through its lease |
| `pnpm worker --status` · `--failures` | inspect (read-only) |
| `pnpm worker --retry-failed --operator=<name>` | requeue FAILED outbox events. **Writes** |

Locally, nothing needs a worker to sign in or use the app. Without one,
notifications stay in the outbox and uploads wait for scanning, except where
`PROJECT_3D_PROCESSING` or a scanner of `none` handles it inline. Several
workers may overlap, because each job is leased and safe to run twice.

Full reference: [../workers.md](../workers.md) · job matrix
[../worker-matrix.md](../worker-matrix.md) · operations
[../worker-operations.md](../worker-operations.md) · runbooks
[../runbooks/workers.md](../runbooks/workers.md),
[../runbooks/notification-worker.md](../runbooks/notification-worker.md).
Variables: [environment.md](environment.md#workers-libcorejobsworkerenvts).
