# Release and rollback (short version)

## What a deploy does

A push to `main` deploys to Vercel (project `nestoerp`, region `fra1`), and
`scripts/vercel-build.sh` runs in the build:

1. `prisma migrate deploy` against the deployment's database. **Always. It writes the schema.**
2. The demo seed, only with `NESTO_SEED_ON_BUILD=1`, `NESTO_SEED_TARGET` naming
   this exact database, an environment that is not production or staging, and zero
   users. Otherwise it is skipped and says why.
3. `next build`.

So merging a migration applies it to production on the next deploy. Review the
migration risk before merging ([../runbooks/database-migrations.md](../runbooks/database-migrations.md)).

## Before release

- CI green on the commit (`static`, `verify`, `security`, and `release` on main).
- Migration reviewed. Additive first (expand/contract) when old and new code
  overlap. Never edit an applied migration.
- Release-validation steps not in CI recorded in `docs/release-readiness.md`
  (see [testing.md](testing.md#ci-githubworkflowsciyml)).

## Rollback

- **Code:** promote the previous Vercel deployment. Schema changes stay, which
  is why migrations must stay backward-compatible with the previous release.
- **Schema/data:** forward-repair with a new migration. Never `migrate reset`,
  `db push` or a re-seed on a populated database. Restore follows
  [../runbooks/database-restore.md](../runbooks/database-restore.md).

Full procedures: [../runbooks/deployment.md](../runbooks/deployment.md) ·
[../runbooks/release-rollback.md](../runbooks/release-rollback.md) ·
[../runbooks/hotfix.md](../runbooks/hotfix.md) ·
[../runbooks/disaster-recovery.md](../runbooks/disaster-recovery.md).
