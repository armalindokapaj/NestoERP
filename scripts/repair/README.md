# Repair scripts

One-off corrections to data that a bug or an incident left wrong (PRD #51 §167,
§168). None exist today.

A repair script is not a job. If the same correction is needed again and again,
the cause is a missing guard or a missing job: fix that, register the job in
`lib/core/jobs/job.registry.ts`, and give it contract tests. A repair script that
quietly runs on a schedule is business logic nobody can find.

Every script here must:

- **say why it exists** — the incident or defect, the date, and the commit that
  fixed the cause, in its header comment;
- **go through the owning domain's service**, not raw writes to its tables, with
  the same company scope, state guards and audit a person's change would have;
- **default to a dry run** that prints counts only, and require an explicit flag
  (and `--environment=production` in production) to write;
- **be safe to run twice**;
- **say when it can be deleted** — normally once it has run in every environment
  that had the bad data — and be deleted then.
