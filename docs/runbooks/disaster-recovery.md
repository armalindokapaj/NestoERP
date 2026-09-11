# Disaster recovery runbook

Per PRD #33 §95, §107, §112.

## Targets

| Objective | Target |
|---|---|
| Database RPO | ≤ 15 minutes |
| Database RTO | ≤ 4 hours |
| Object storage RPO | ≤ 24 hours |
| Object storage RTO | ≤ 8 hours |
| Whole-platform recovery | ≤ 8 hours |

Internal engineering targets, not contractual SLAs (PRD #33 §7).

## Flow

```
Declare incident
↓
Freeze or reroute writes if required
↓
Determine the damage window
↓
Select backup or restore point
↓
Restore to an isolated instance
↓
Validate (see database-restore.md)
↓
Reconcile files, workers, caches
↓
Cut over
↓
Run the smoke suite
↓
Monitor
↓
Close the incident
```

## Recovery order

1. PostgreSQL
2. Authentication and company access
3. Original documents
4. Core operational modules
5. Workers and outbox
6. Derived previews, search, caches

Derived data is rebuilt, not restored: `InventoryBalance` comes back from
`StockMovement`, report caches recompute, search reindexes (PRD #33 §101-§104).

## Scenarios covered

Accidental database deletion · logical corruption · infrastructure failure ·
bad migration · bad deployment · bucket deletion · single file deletion ·
storage credential compromise · regional outage · cache outage · worker outage.
