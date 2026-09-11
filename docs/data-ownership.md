# Data ownership

Per PRD #37 §201-§207, PRD #23 §5.

One concept has one canonical owner. Only the owning module's domain service
may mutate its records; everyone else references, reads through a read service,
or calls the owner's command (PRD #37 §202).

| Model | Owner |
|---|---|
| `User` | Authentication |
| `Company`, `CompanySettings`, `CompanyModule` | Company / Settings |
| `CompanyMember`, `Department` | Team |
| `Project`, `ProjectMember` | Projects |
| `Client`, `Contact` | Clients |
| `Task` | Tasks |
| `Document` | Documents |
| `Invoice`, `Expense`, `Payment`, `ProjectBudget`, `Commitment` | Finance |
| `EmployeeProfile`, `LeaveRequest`, `AttendanceRecord`, `Compensation` | HR |
| `Lead`, `Opportunity`, `Proposal` | Sales |
| `Contract` | Legal |
| `PurchaseRequest`, `PurchaseOrder` | Procurement |
| `InventoryItem`, `StockMovement` | Inventory |
| `AuditEvent` | Audit platform |
| `Notification`, `AttentionItem` | Attention platform |
| `IntegrationLink`, `IntegrationAttempt` | Integration platform |

## What this forbids

Procurement does not insert a `Commitment` with Prisma — it calls the Finance
service (PRD #23 §169, §170). QA does not insert a task-shaped row — it calls
the Task service (PRD #37 §205). Sales does not create its own customer — there
is one `Client` (PRD #23 §6).

## Anti-duplication

There is no `FinanceProject`, `ProcurementProject`, `SalesCustomer`,
`FinanceCustomer`, `QualityTask` or `HseTask`, and there must not be
(PRD #35 §11).
