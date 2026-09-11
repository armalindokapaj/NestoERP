# Release rollback runbook

Per PRD #34 §143-§150, §312.

## Decide first: rollback or forward fix

Code rollback is safe. Database rollback is not assumed (PRD #34 §146). Ask:

- Has the new schema been written to since deploy?
- Is the previous application version compatible with the current schema?
- Have workers produced side effects under the new version?

If the previous artifact cannot run against the current schema, **forward fix**
(PRD #34 §147, §219).

## Rollback triggers

Any of these justifies stopping the rollout immediately (PRD #34 §251, §252):

- Login broken
- 5xx spike
- Cross-company isolation defect
- Critical module unavailable
- Database incompatibility
- Audit writes failing
- Financial or inventory integrity failure

## Procedure

1. Announce the rollback in the engineering channel.
2. Redeploy the previous immutable artifact by its git SHA (PRD #34 §145).
3. Confirm readiness and run the post-deploy checks from `deployment.md`.
4. If the schema has moved on incompatibly, do not force it — follow
   `database-restore.md` and consider PITR (PRD #33 §128).
5. Record what happened in the release history (PRD #34 §151).

## Stop-ship conditions

Never continue a rollout through a cross-tenant leak, an authentication bypass,
data corruption, or public exposure of a private file (PRD #34 §252).
