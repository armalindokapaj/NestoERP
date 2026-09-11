# Data model

Per PRD #37. The Prisma schema is canonical; this is the map.

## Tenancy

Every business record carries `companyId` and resolves to exactly one `Company`
(PRD #37 §4). Foreign keys cannot express "these two rows belong to the same
company", so domain services validate that before every cross-record write
(PRD #37 §5, §124).

`Company` deletes **restrict** into business data. 33 relations were changed
from `Cascade` to `Restrict` so that one erroneous company delete cannot take a
tenant's entire history with it (PRD #37 §12, §189, §193). `Session` and
`CompanyInvite` keep `Cascade`: they are ephemeral auth artefacts (PRD #37 §36).

## Identity and access

```
User ── CompanyMember ── Company
             ├── Role ── RolePermission ── Permission
             ├── Department
             └── ProjectMember ── Project
```

`User` is the global login. `CompanyMember` is the access-bearing membership and
is what business records point at (PRD #37 §219). `CompanyMember.accessVersion`
increments whenever role, department, project membership or status changes, so
permission-sensitive caches key off it (PRD #37 §34).

`Company.configVersion` does the same for configuration (PRD #37 §22).

## Configuration

| Model | Owns |
|---|---|
| `CompanySettings` | locale, timezone, date format, base currency, fiscal year, payment terms |
| `FinanceSettings` | invoice prefix, tax rate override — finance-specific only |
| `CompanyIntegrationSettings` | quality gate, automatic finance commitments |
| `CompanyNumberingScheme` | how human-readable numbers are generated |
| `CompanyModule` | which modules are on |

Base currency lives in exactly one place. The duplicate on `FinanceSettings` was
removed by `20260911150000_finance_settings_deduplication_prd_24` (PRD #24 §41-§43).

## Platform

| Model | Purpose |
|---|---|
| `Activity` | Business history, user-facing |
| `AuditEvent` | Security and compliance evidence, append-only |
| `Notification` | A message to one member |
| `AttentionItem` | An unresolved condition |
| `NotificationEventOutbox` | Durable handoff from transaction to delivery |
| `IntegrationLink` | Provenance of a cross-module handoff |
| `IntegrationAttempt` | Technical retry history and idempotency |

Activity and Audit are deliberately separate and neither is derived from the
other (PRD #28 §362, §363).

## Precision

Money is `Decimal(18,2)`, quantity is `Decimal(18,4)`, currency is
`VarChar(3)`. `Float` is never used for anything that must add up
(PRD #37 §13, §14, §17).

## Known gap

Inventory still carries the placeholder `InventoryItem` / `InventoryMovement`
shape. PRD #37 §85-§88 requires immutable `StockMovement` plus a derived
`InventoryBalance`, with `signedQuantity` and `Decimal(18,4)` quantities. This
must land with the Inventory module (PRD #20), not after it.
