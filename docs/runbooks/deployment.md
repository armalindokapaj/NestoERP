# Deployment runbook

Per PRD #34 §92, §132, §317.

## Before you start

- [ ] CI green on the exact commit being deployed
- [ ] Staging is running that same artifact and is healthy
- [ ] Migrations reviewed for locking and data loss (see `database-migrations.md`)
- [ ] Backup and PITR healthy (see `database-restore.md`)
- [ ] Previous artifact still available to roll back to

## Sequence

1. **Verify backup health.** For any HIGH-risk migration this is mandatory, not
   advisory (PRD #34 §91, PRD #33 §130).
2. **Apply migrations** as a dedicated one-off job:
   ```
   pnpm db:deploy        # prisma migrate deploy
   ```
   Never `prisma migrate dev` or `prisma db push` against a deployed database
   (PRD #34 §67, §68). Application instances do not auto-migrate on startup
   (PRD #34 §231).
3. **Deploy the application.** Readiness (`/api/health/ready`) must pass before
   an instance takes traffic (PRD #34 §127, §129).
4. **Deploy workers** once the schema they expect is live (PRD #34 §109):
   `pnpm worker --group=notifications`, `--group=documents`, `--group=scheduled`
   (or one `pnpm worker`). See `workers.md`.
5. **Run post-deploy smoke** — see `Post-deploy checks` below.

## Post-deploy checks

```
GET /api/health/live      → {"status":"ok"}
GET /api/health/ready     → {"status":"ok"}
```

Then, within the first few minutes (PRD #34 §141):

- [ ] 5xx rate at baseline
- [ ] API latency at baseline
- [ ] Database pool not saturated
- [ ] Worker queue age not growing
- [ ] No audit write failures
- [ ] Login works for a synthetic account

## If it goes wrong

See `release-rollback.md`. Code rolls back; a database migration does not
(PRD #34 §146).
