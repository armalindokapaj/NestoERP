# Hotfix runbook

Per PRD #34 §216-§219, §319, §416.

Urgency does not remove the security and tenant-isolation gates (PRD #34 §217).

## Procedure

1. Branch from the current release commit, not from an in-progress feature line.
2. Make the **minimal** fix. Resist bundling anything else in.
3. Run the mandatory CI gates — all of them.
4. Get a review. One reviewer minimum, even at 3am.
5. Deploy to staging if at all feasible.
6. Approve and deploy to production.
7. Merge back so the next release contains the fix.

## Checklist

- [ ] Scope is minimal
- [ ] Incident linked
- [ ] Test added that would have caught it
- [ ] Security and tenant tests still run
- [ ] Reviewer approved
- [ ] Migration avoided if at all possible (PRD #34 §218)
- [ ] Rollback path known
- [ ] Post-deploy verification done
