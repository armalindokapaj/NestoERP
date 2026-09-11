# Database restore runbook

Per PRD #33 §27-§46, §108, §112.

## A backup is not trustworthy until a restore has been tested

Restore drills are quarterly (PRD #33 §37). A successful backup job proves
nothing on its own (PRD #33 §36).

## Restore types

| Type | When |
|---|---|
| Full restore | Total loss or corruption |
| Point-in-time (PITR) | A known bad action at a known time |
| Partial / entity recovery | Isolated damage where a full rollback would discard valid later work |
| Single object | One missing or deleted document |

## Procedure

1. **Declare the incident** and freeze writes if required (maintenance mode).
2. **Determine the damage window** using Audit (`/settings/audit`), correlation
   IDs and deployment history (PRD #33 §29).
3. **Restore into a new, isolated instance.** Never restore over the live
   production database first (PRD #33 §28).
4. **Validate before cutover** (PRD #33 §41, §140):
   - [ ] Schema/migration version matches the deployed application
   - [ ] Company count and active memberships correct
   - [ ] Role, permission and module configuration intact
   - [ ] Finance samples reconcile
   - [ ] `InventoryBalance` agrees with `StockMovement`
   - [ ] A sample of AVAILABLE documents still resolve to a stored object
   - [ ] Audit is continuous across the restore point
5. **Reconcile** object storage, workers and caches (PRD #33 §116, §120, §123).
6. **Cut over**, then run the recovery smoke suite (PRD #33 §42).
7. **Invalidate sessions** where state is ambiguous (PRD #33 §118).

Validation failure means the restored instance is not promoted. Investigate or
choose another restore point (PRD #33 §154).

## Measure it

Every drill records actual RPO, actual RTO, what broke and what was fixed
(PRD #33 §43, §44).
