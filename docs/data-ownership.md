# Data ownership

Per PRD #48 §3–§11, §300; PRD #37 §201–§207; PRD #23 §5.

One concept has one owner. Only the owning domain's service may change its
records; everyone else reads through a read service or calls the owner's door.

```
A domain owns its data
+ other domains request changes through the owner
+ critical operations are atomic
= state that cannot disagree with itself
```

Ownership is about **mutation**, not visibility. Reporting, search, the
dashboard and every cross-module list read whatever the reader is allowed to
see; none of them may write (PRD #48 §5, §100–§102).

## How this is enforced

This file is not the enforcement — it explains it. The enforcement is:

| Where | What it checks |
|---|---|
| `scripts/architecture/ownership.ts` | The registry: every model's owner, every reviewed exception, every aggregation point. |
| `pnpm verify:ownership` | Every Prisma mutation in `lib/`, `app/` and `scripts/` is by the owner or a recorded exception; nothing under `app/` writes; no new dependency cycle. |
| `pnpm verify:ownership --report` | The audit output of PRD #48 §252: every model, its owner, and every domain that writes it. |
| `tests/architecture/ownership.test.ts` | The same rules from `pnpm test`, plus a named test for each drift PRD #48 §293 lists. |
| `tests/integration/transactions/` | Rollback, idempotency and concurrency against a real database. |

A domain is a directory. `lib/modules/finance/**` is `finance`;
`lib/core/notifications/**` is `core/notifications`. The gate derives the
writer's domain from the file's path, so moving a file moves its obligations
with it.

## Owners

| Domain | Owns |
|---|---|
| `auth` | `User`, `Session`, `PasswordResetToken`, `AuthEvent` |
| `core/access` | `Role`, `Permission`, `RolePermission`, `Module`, `RoleModuleAccess` |
| `team` | `CompanyMember`, `Department`, `CompanyInvite` |
| `settings` | `Company`, `CompanyOwner`, `CompanySettings`, `CompanyIntegrationSettings`, `CompanyNumberingScheme`, `CompanyModule` |
| `platform` | `PlatformAccess`; `DemoRecord` — where a demonstration tenant's seeded facts come from, written by its seed and read by `verify:demo` only (D-01, ADR 0005) |
| `shared` | `Activity` |
| `core/audit` | `AuditEvent` |
| `core/notifications` | `Notification`, `NotificationPreference`, `NotificationEventOutbox`, `AttentionItem` |
| `core/integrations` | `IntegrationLink`, `IntegrationAttempt` |
| `core/collaboration` | `CollaborationThread`, `Comment`, `Mention`, `Subscription` |
| `core/approvals` | `ApprovalStep` |
| `approvals` | `ApprovalDelegation`, `ApprovalDecisionReceipt` |
| `core/security` | `RateLimitBucket` |
| `core/jobs` | `WorkerHeartbeat` |
| `mail` | `MailDelivery` |
| `projects` | `Project`, `ProjectMember`, `ProjectType` |
| `clients` | `Client`, `Contact` |
| `tasks` | `Task` |
| `documents` | `Document`, `DocumentVersion`, `DocumentReview`, `DocumentUploadSession`, storage quota and usage |
| `finance` | `Invoice`, `Expense`, `Payment`, `ProjectBudget`, `Commitment`, `FinanceApproval`, `FinanceSettings`; `PaymentAllocation` — what part of a payment settles which invoice, expense or installment, the only way any payment settles anything; `PaymentSchedule`, `PaymentInstallment` — a sale contract's versioned schedule (E-05F) |
| `hr` | `EmployeeProfile`, `Compensation`, `LeaveRequest`, `LeaveBalance`, `AttendanceRecord`, `EmploymentAssignment`, `EmploymentStatusHistory`, `EmploymentChange` |
| `sales` | `Lead`, `Opportunity`, `Proposal`, `SalesApproval`; `UnitCommercialProfile`, `UnitPriceHistory`, `UnitReservation`, `UnitReservationExtension`, `OpportunityUnit`, `UnitCommercialStatusHistory` — a unit's price, commercial status, reservations and deals (E-05E); `UnitSaleApproval` — a sale approved before it is marked Sold (E-05F). The unit stays project structure's, read through its door; clients are created through the Clients service |
| `contracts` | `Contract`, `ContractParty`, `ContractObligation`, `ContractAmendment`, `ContractApproval`; `ContractUnit`, `UnitContractRequest` — the units a sale contract sells and Sales' requests for one (E-05F) |
| `procurement` | `Supplier`, `PurchaseRequest`, `RFQ`, `SupplierQuote`, `PurchaseOrder`, `GoodsReceipt`, procurement approvals |
| `inventory` | `InventoryItem`, `Warehouse`, `InventoryBalance`, `StockMovement`, every stock document |
| `qaqc` | inspections, material releases, defects, NCRs, corrective actions |
| `hse` | inspections, hazards, incidents, risk assessments, permits, toolbox talks; `HseIncidentPerson`, `HseWorkPermitWorker`, `HseInduction` — the employees an incident involved, the workers or crews a permit covers, site inductions (E-04) |
| `workforce` | `WorkforceTrade`, `WorkforceCrew`, `WorkforceCrewMember`, `EmployeeProjectAssignment` — where employees work and with whom, login or not; `EmployeeImportBatch` — a bulk import's validated rows (E-04, ADR 0006). The employment stays HR's |
| `calendar` | `CalendarEvent`, `CalendarEventParticipant`, `CalendarReminder`, `CalendarReminderDelivery` |
| `meetings` | `Meeting`, `MeetingSeries`, agenda, minutes, decisions, action items |
| `timesheets` | `Timesheet`, `WorkLog`, timesheet approvals and settings |
| `daily-logs` | `DailyLog` and its sections, `DailyLogCorrection`, settings |
| `project-planning` | `ProjectPhase`, `ProjectMilestone`, dependencies, blockers |
| `project-structure` | `ProjectSite` — a named place of a project where its work happens (E-04); `ProjectBuilding`, `ProjectFloor`, `ProjectUnit`, `ProjectUnitType` — the one canonical unit every module references by id (E-05B); `UnitPublication`, `UnitMedia`, `UnitDocumentLink`, `UnitPublicationApproval` — its published versions, images, document references and publishing requests (E-05D). The Documents they point at stay the Documents domain's |
| `announcements` | `Announcement`, audience, reads, acknowledgments |
| `productivity` | `UserFavorite`, `RecentItem`, `ProductivitySettings` |
| `contractors` | `ContractorProfile`, assignments, compliance items |
| `work-packages` | `WorkPackage` |
| `engineering` | `EngineeringDocument` and revisions, `Rfi`, `TechnicalSubmittal`, `DocumentTransmittal` |

`scripts/architecture/ownership.ts` is the machine-readable version and is the
one the gate reads. `pnpm verify:ownership --report` prints every model.

## The cross-domain doors

Where one domain genuinely has to change another's record, the owner exposes a
function that takes the caller's transaction. The caller decides *whether*; the
owner decides *how*.

| Door | Owner | Called by | The owner's part |
|---|---|---|---|
| `ensureCommitmentForSource` / `settleCommitmentForSource` | finance | procurement | One commitment per source record, a legal status transition, never a manually raised commitment. |
| `createTaskFromContextIn` | tasks | meetings, qaqc, hse | The task permission, the parent record, the parent's project, the assignee. |
| `syncActionFromTask` | meetings | tasks | A completed task closes its action; a reassigned task reassigns it. |
| `setSharingClassification` | documents | engineering | The document is this company's and really is on the record named. |
| `resolveAttentionFor` | core/notifications | announcements, daily-logs, documents, timesheets, approvals | What "resolved" means, including for an item already dismissed. |
| `linkReference` / `unlinkReference` | core/integrations | daily-logs, engineering, project-planning | One row per relationship, cancelled rather than deleted. |
| `setMeetingReminders` / `clearMeetingReminders` | calendar | meetings | The reminder row, its per-member uniqueness, its delivery. |
| `reassignOpenSteps` | core/approvals | timesheets | Only pending steps move; a decision keeps whoever made it. |
| `writeCompanySettings` | settings | finance | The `configVersion` bump that invalidates configuration caches. |
| `cancelSchedulesWithContract` / `completeScheduleWithContract` | finance | contracts | A sale contract cancelled, terminated or expired cancels its schedules with the reason; completed, completes the one in force — through the `payment_schedule` machine, never a status write. |
| `contractFinancialStatus` / `unitSaleReadiness` | finance | contracts, sales | What a contract has been paid and whether its deposit is in, read from live allocations — the facts Complete and the Sold rule need, without either domain reading Finance's tables. |
| `setPassword`, `createUserForInvite`, `revokeSessions` | auth | account, team | Hashing, voiding outstanding reset links, what a revocation is. |
| `ensurePersonForUser` | hr | team (handed in by the invitation action) | Every login working in a group is a person of it: linked by email to an unlinked person of the group, or made from the account (E-01 §219). |
| `updatePersonWorkProfile` | hr | people | Only the work-profile columns, only inside the group; one email per person in the group. |
| `openBranch`, `closeBranch`, `renameBranches`, `nameBranchManager` / `clearBranchManager`, `placeHomeIfUnplaced` / `moveHome` | team | organization | The branch row and the membership: a branch is opened again rather than duplicated, closed rather than deleted; a manager is cleared only if still theirs; a home is moved only if still where the caller left it (E-13, ADR 0003). |
| `placeMembership` | organization | team (handed in by the member and invitation actions), hr (handed in by the employment routes, actions and job) | Where Team places a membership, its member place on that department's team follows: ended in the old branch, made in the new one, with the membership's role (ADR 0003 decision 5); then HR's history follows the membership (ADR 0004). |
| `setMemberPlacement` | team | hr | A membership's department and title set to what its employment says — only those two columns, never the role (E-03, ADR 0004 decision 7). |
| `followMembership` | hr | organization | A running employment records the department or title its membership now has, as a change dated today (source SYNC), or revises a planned employment's plan; nothing when they agree (ADR 0004 decision 7). |
| `linkEmploymentToLogin` | hr (`person.doors.ts`) | organization | The employment gains the provisioned login; the manager the request named and the membership's department and title are recorded as history, never written over. |
| `createImportedEmployment` | hr (`employee.doors.ts`) | workforce (import) | A new person and an employment with its first history rows and audit, made as HR makes one by hand; no login (E-04, ADR 0006). |
| `writeSiteAttendance` | hr (`attendance.doors.ts`) | workforce (site sheet) | One attendance row per employment and day, source `SITE`, never over a day HR recorded; refused for an employment not working. |
| `endWorkforce` | workforce | hr (handed in as `ChangeOptions.workforce` by the employment routes, actions and job) | An employment ending or transferring ends its open crew memberships and project assignments on the last day, and withdraws those not yet begun. |
| `employmentsVisibleTo` (read) | hr | people | Each employment judged in its own company by HR's own permission and scope; pay never included. |
| `recordActivity`, `recordActorActivity` | shared | everyone | The activity row's shape and its actor. |

Each takes `(tx, context, …)` and does no I/O of its own beyond the database,
so it is safe inside the caller's transaction (PRD #48 §24, §25, §115).

## What this forbids

Procurement does not insert a `Commitment` with Prisma — it calls Finance's
door (PRD #23 §169, §170). Meetings does not set `Task.status`; it asks Tasks
(PRD #48 §60, §75). Engineering does not reclassify a `Document`; it asks
Documents (§89). No feature module writes `AttentionItem` or `IntegrationLink`
(§66, §64). QA does not insert a task-shaped row of its own — there is one
`Task` (PRD #37 §205). Legal does not cancel a payment schedule; it asks
Finance (E-05F §82). Sales does not create its own customer — there is one
`Client` (PRD #23 §6).

## Anti-duplication

There is no `FinanceProject`, `ProcurementProject`, `SalesCustomer`,
`FinanceCustomer`, `QualityTask` or `HseTask`, and there must not be
(PRD #35 §11).

## The exceptions

Four, each reviewed and each held to something narrower than "this domain may
write that table". The reasons live with them in
`scripts/architecture/ownership.ts`; the shape of each is:

- **Provisioning** — `company-bootstrap.service.ts` and
  `company-config.service.ts` write the opening rows of several domains,
  because a company being created has no modules in use to ask. Once per
  company (PRD #48 §263, §266).
- **Retention** — `retention.service.ts` deletes across every domain, because
  it is the one place that knows how long each class of record is kept
  (PRD #33). It deletes only what its policy names.
- **Co-owned columns** — a domain that owns some columns of a shared row and
  none of the others: Planning's two settings on `Project`, Account's profile
  fields on `User`, the numbering allocator's sequence counter on
  `CompanyNumberingScheme`. The gate reads the columns each call names and
  fails if one strays (PRD #48 §252). The activity recorder's
  `Project.lastActivityAt` is the one co-owned column the gate cannot see: it is
  written by raw SQL, deliberately, so the write does not move `updatedAt`. The
  gate refuses an exception it never sees used, so the decision is recorded
  here and in `lib/modules/shared/activity.ts` rather than in the registry
  (E-05A §15, `docs/projects-page.md`).
- **Module seeding** — access sync creates a `CompanyModule` row for a module
  newly added to the deployment, so an existing company has something to
  toggle. It never changes `enabled`.

An exception that stops being used fails the gate: a door left open that nobody
walks through is removed, not kept.

## Adding to this

**A new model.** Add it to `OWNED` in `scripts/architecture/ownership.ts` under
its domain. The gate fails on a model with no owner, so this is not optional.

**A new cross-domain write.** Write the door on the owner's side, taking
`(tx, context, …)`, and call it. If you think an exception is the answer
instead, write the reason first — if the reason is "it was easier", it is not
one.

**A new registry** that imports every domain: add it to `AGGREGATION_POINTS`
with what it lists. Its imports are cut from the dependency graph, which is
only honest for a file that exists to hold a list.

See also [transaction boundaries](transaction-boundaries.md) for what commits
together, and [domain dependencies](domain-dependencies.md) for which way the
arrows point.
