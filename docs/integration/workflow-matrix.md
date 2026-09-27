# Cross-module workflow matrix (AUD-10)

Per AUD-10 §2 and CW-01. One row per existing link or command between modules:
who owns what, which fields are authoritative, what commits together, what is
delivered afterwards, what keeps a retry from doing it twice, where the result
is read, which tests prove it, and whether it works.

This file is checked. `tests/api/integration/workflow-matrix.test.ts` fails when
an approval provider registered in `lib/modules/approvals/approvals.registry.ts`
has no row in §1, when a provider row names a provider that no longer exists,
or when a record type registered in `lib/core/records/record.registry.ts` is
missing from the link-target index in §9 (or the index names one that is not
registered). A new provider or record type is not done until it has a row here.

**Status vocabulary.** *implemented* — works and a test proves it end to end;
*untested* — the code path exists but nothing exercises the cross-module
contract; *broken* — a defect found by the AUD-10 surveys and still open;
*implemented (fixed in AUD-10: …)* — broken at `0c3aa0f7`, fixed and tested in
the AUD-10 change set, with what was wrong; *not supported* — no such integration exists,
and AUD-10 §1 says an absent integration stays absent. A UI link is never
evidence of an implemented integration (§2).

**Common contract.** Every synchronous boundary below is one `runInTransaction`
(or `prisma.$transaction`) that commits the source change, the required
relation change, the activity row, required audit and the outbox intent
together (`docs/transaction-boundaries.md`). Delivery is the notification
worker (`lib/core/notifications/notification.dispatch.ts`): at least once,
`FOR UPDATE SKIP LOCKED` leases, 5 attempts with backoff, terminal `FAILED`
with `lastErrorCode` and `job_failures` history, operator retry through the
worker CLI, recipient access re-read at delivery, one `Notification` per
`(company, recipient, dedupeKey)`. Since AUD-10 (gap 9) the request's
`correlationId` is written on the activity, the outbox row, the audit row, the
worker's `job_failures` rows and the resulting `Notification`, so one id
follows a command end to end. It is set by `withContext` for API routes; a
server action that runs outside a request context writes `null`, never an
invented id.

Abbreviations: **M** `lib/modules/`, **tx** the synchronous boundary, **ob**
outbox event(s), **PA** `PENDING_APPROVAL`. Test paths are under `tests/`.

## 1. Approval providers (Approvals Center)

All eleven are read by `lib/modules/approvals/approvals.service.ts` and decided
through `decideApproval` → `provider.decide`, which calls the owning module's
decision service; the Center keeps no status of its own (§4). Center counts are
read models over the module's cycle table. Actors: the provider's `available()`
is module enabled + module access; deciding needs the permissions listed.
Self-approval is refused unless the module's `*.approval.self` grant exists.
For the six cycle providers marked **(C)** the decision calls
`notifyApprovalDecided` (`lib/core/notifications/approval-notifications.ts`),
which in the same tx enqueues `APPROVAL_APPROVED|REJECTED|RETURNED` (dedupe
`perEvent` = `eventType:outboxId:member`), resolves the `PENDING_APPROVAL` /
`APPROVAL_OVERDUE` attention items and writes the required audit
`APPROVAL_*`. Stale-page and cross-cycle protection: `assertApprovalGuard`
(`lib/core/approvals/approval-guard.ts`) with `{approvalId, stepNumber}`.

| Provider | Source entity / service | Target (cycle) entity | Company / project | Allowed actors (decide) | Authoritative fields | State mapping | Synchronous tx | Asynchronous effects | Unique / dedupe key | Read surfaces | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `finance` (C) | `invoices`, `expenses`, `project_budgets`, `commitments` — M/finance/{invoices,expenses,budgets,commitments}/*.service.ts approve/reject/return | `finance_approvals` (`recordType` INVOICE/EXPENSE/BUDGET/COMMITMENT, `recordId`) | companyId; projectId (required on budgets) | `finance.approval.decide` or `finance.<type>.approve/.reject`; self needs `finance.approval.self` | source `status`; cycle `status`, `decidedBy`, `decidedAt` | source PA ⇄ cycle PENDING; approve → APPROVED/APPROVED; reject → REJECTED/REJECTED; return → DRAFT/RETURNED | `moveStatus` + cycle `updateMany` on PENDING + activity `FINANCE_*` + required audit + ob | ob `APPROVAL_*` to submitter; attention resolved in tx | one PENDING per record: partial unique index (AUD-10 agent 2 migration `20260927110000`) | source detail, finance registers, Center queue/counts, requester "requested" tab, dashboard approvals widget | api/finance/finance-service, api/approvals/approvals-center (expense), api/approvals/aud10-center-providers | implemented (fixed in AUD-10: stale-page guard, Center honesty)|
| `procurement` (C) | `purchase_requests`, `purchase_orders` — M/procurement/{requests,orders}/*.service.ts | `procurement_approvals` (PURCHASE_REQUEST / PURCHASE_ORDER) + `approval_steps` chain for orders | companyId, projectId? | `procurement.request|order.approve/.reject`; self `procurement.approval.self` | as finance; order chain: `approval_steps.status` per `stepNumber` | PA ⇄ PENDING; an intermediate order step approves the step only (source stays PA, next step PENDING once); final step → APPROVED | step settle + chain advance + (final) transition + cycle + activity + required step audit + ob in one tx | ob `APPROVAL_*`, `PO_APPROVAL_REQUIRED` for the next step | `approval_steps @@unique([providerKey, approvalId, stepNumber])`; one-PENDING index (agent 2) | as finance + procurement queues | api/procurement/procurement-service, api/approvals/approvals-center (PO chain) | implemented (fixed in AUD-10: unguarded source-page decisions, unordered `findFirst`)|
| `hr` | `leave_requests` — M/hr/leave/leave.service.ts `approveLeave`/`rejectLeave` | none: the leave row is its own approval (`approvedByMemberId`, `rejectedByMemberId`) | companyId; no project | `hr.leave.approve` / `hr.leave.reject` | leave `status`, decider columns | PENDING → APPROVED / REJECTED; REJECTED → resubmit → PENDING | status + activity `HR_LEAVE_*` + audit (optional) + ob in one tx | ob `LEAVE_DECIDED` | no cycle id; version guard being added | leave detail, HR queue, Center | api/hr/hr-service, api/approvals/approvals-center (leave) | implemented (fixed in AUD-10: no in-tx precondition, activity-count version (ABA on resubmit))|
| `sales` (C) | `proposals` — M/sales/proposals/proposal.service.ts | `sales_approvals` (PROPOSAL) | companyId | `sales.proposal.approve/.reject`; self `sales.approval.self` | as finance | PA ⇄ PENDING; approve → APPROVED; reject → REJECTED; return → DRAFT | as finance | ob `APPROVAL_*` | one-PENDING index (agent 2) | proposal detail, sales pipeline, Center | api/sales/sales-service, api/approvals/aud10-center-providers | implemented (fixed in AUD-10) |
| `legal` (C) | `contracts`, `contract_amendments` — M/contracts/{contracts,amendments}/*.service.ts | `contract_approvals` (CONTRACT / AMENDMENT) | companyId; projectId? on contracts | `legal.approval.decide` and `legal.<type>.approve/.reject` | as finance | PA ⇄ PENDING; → APPROVED / REJECTED / DRAFT | as finance | ob `APPROVAL_*` | `contract_approvals_one_pending_per_record` (existing) | contract detail, legal lists, Center | api/contracts/contract-service, api/approvals/approvals-center (amendment) | implemented; stale-page guard implemented (fixed in AUD-10) |
| `documents` | `document_versions.reviewState` — M/documents/versions/review.service.ts `decideReview` | `document_reviews` (parallel, one per reviewer) | companyId; Document.projectId? | assigned reviewer (or delegate) with `document.review.decide` | review `status`; version `reviewState` | version IN_REVIEW ⇄ ≥1 PENDING review; decision settles the review and siblings, version → APPROVED / REJECTED | `applyTransition` on review(s) + version + activity + required audit `DOCUMENT_REVIEW_DECIDED` + ob | ob `DOCUMENT_APPROVED` / `DOCUMENT_REJECTED` / `DOCUMENT_SUPERSEDED` | `pendingKey @unique` (`versionId:reviewerId` while PENDING) | document versions panel, Center | api/documents/document-versions, api/approvals/approvals-center (review) | implemented; Center version token implemented (fixed in AUD-10) |
| `qaqc` (C) | `quality_inspections`, `non_conformance_reports` — M/qaqc/{inspections,ncrs}/*.service.ts | `quality_approvals` (INSPECTION / NCR) | companyId, projectId? | `qaqc.inspection|ncr.approve/.reject`; self `qaqc.approval.self` | as finance | PA ⇄ PENDING; inspection → APPROVED/REJECTED; NCR → APPROVED_FOR_CLOSE / back to IN_PROGRESS | as finance | ob `APPROVAL_*` | one-PENDING index (agent 2) | QA/QC registers, Center | api/qaqc/qaqc-service, api/approvals/aud10-center-providers | implemented (fixed in AUD-10) |
| `hse` (C) | `hse_inspections`, `hse_risk_assessments`, `hse_work_permits` (PA), `hse_incidents` (PENDING_CLOSE) — M/hse/*/**.service.ts | `hse_approvals` (INSPECTION / RISK_ASSESSMENT / WORK_PERMIT / INCIDENT_CLOSE) | companyId; projectId (required on permits) | per type: `hse.inspection.approve/.reject`, `hse.risk.approve`, `hse.permit.approve`, `hse.incident.close` (incidents cannot be rejected) | as finance | PA/PENDING_CLOSE ⇄ PENDING; reject returns risk/permit to DRAFT | as finance | ob `APPROVAL_*` | one-PENDING index (agent 2) | HSE registers, Center | api/hse/hse-service, api/hse/hse-authorization, api/approvals/aud10-center-providers | implemented (fixed in AUD-10: Center self-check narrower than domain (A8))|
| `timesheets` | `timesheets` (SUBMITTED) — M/timesheets/timesheet.submission.ts `decide` | `timesheet_approvals` (TIMESHEET, `submissionVersion`) + `approval_steps` | companyId | `timesheet.approve`; reject needs `timesheet.reject` | timesheet `status`, `version`; cycle `status` | SUBMITTED ⇄ PENDING; → APPROVED / RETURNED / REJECTED | step settle + cycle + timesheet `updateMany` on version + activity + required audit + ob | ob `TIMESHEET_APPROVED|RETURNED|REJECTED` | `TIMESHEET_SUBMITTED:<id>:<submissionVersion>:<member>`; one-PENDING index (agent 2) | timesheet pages, team queue, Center | api/timesheets/timesheets | implemented; reject permission and cycle scoping implemented (fixed in AUD-10) |
| `projects` | `project_units.publicationStatus` — M/project-structure/unit-publishing.service.ts `publishUnit` / `requestUnitRevision` | `unit_publication_approvals` (UNIT) | companyId, projectId | `project.unit.publish`; return `project.unit.revision_request`; no reject | unit `publicationStatus`, `currentPublicationId`; cycle `status` | READY_FOR_PUBLISHING (or PUBLISHED with a submitted correction) ⇄ PENDING; → PUBLISHED / REVISION_REQUIRED | publication snapshot + unit + cycle + `notifyApprovalDecided` + audit `PROJECT_UNIT_PUBLISHED` | ob `APPROVAL_*` | `unit_publication_approvals_one_pending_per_unit` (existing) | unit page, sales availability, Center | api/project-structure/unit-publishing | implemented; version precondition implemented (fixed in AUD-10: A4) |
| `unit_sales` | `unit_commercial_profiles` (RESERVED, active reservation) — M/sales/units/unit-sale-approval.service.ts | `unit_sale_approvals` (UNIT, `reservationId`) | companyId, projectId | `project.unit.sale.approve` | cycle `status`; the source status is **not** moved by a decision (the sale is completed by its own command) | PENDING → APPROVED / REJECTED | cycle `updateMany` + `notifyApprovalDecided` + activity `UNIT_SALE_*` + required audit | ob `APPROVAL_*` | `unit_sale_approvals_one_pending_per_unit` (existing) | unit sales panel, Center | api/finance/unit-finance | implemented; record-type collision with `projects` (both `project_unit`) implemented (fixed in AUD-10: A7) |

### Approval-like decisions that are not Center providers

These decide something, but no provider reads them: they never appear in the
Approvals Center, its counts or the dashboard approvals widget. That is the
current product scope (AUD-10 §1 adds no provider), not a gap.

| Decision | Service | Table / status changed | Events | Status |
|---|---|---|---|---|
| Engineering revision review | M/engineering/engineering.revisions.ts `decideRevision` | `engineering_document_revisions` / `technical_submittal_revisions` → FINALIZED with `reviewDecision`; parent document/submittal status | `ENGINEERING_DOCUMENT_APPROVED`, `…_REVISION_REQUIRED`, `SUBMITTAL_*` | not a Center provider |
| Daily log review | M/daily-logs/daily-log.review.ts `reviewDailyLog` | `daily_logs.status` → REVIEWED | `DAILY_LOG_REVIEWED` | not a Center provider |
| Unit contract request decline | M/contracts/units/unit-contract.service.ts `declineContractRequest` | `unit_contract_requests` OPEN → DECLINED | `UNIT_CONTRACT_REQUEST_DECLINED` | not a Center provider |
| QA/QC corrective action verify / reject | M/qaqc/corrective-actions/action.service.ts `verifyAction` / `rejectAction` | `corrective_actions.status` | — (activity only) | not a Center provider |
| HSE action verify / reject | M/hse/actions/action.service.ts `verifyAction` / `rejectAction` | `hse_actions.status` | — (activity only) | not a Center provider |
| HR employee document verify / reject | M/hr/documents/employee-document.service.ts `decide` | `employee_document_links.verificationStatus` | — | not a Center provider |
| Qualification verify / reject | M/hr/qualifications/qualification.service.ts `decide` | `person_qualifications.verificationStatus` | — | not a Center provider |
| Proposal accept / decline (by the client) | M/sales/proposals/proposal.service.ts `acceptProposal` / `declineProposal` | `proposals.status` → ACCEPTED / DECLINED (accept also moves the opportunity) | — | not a Center provider |
| Candidate rejection | M/hr/recruitment/candidate.service.ts `rejectCandidate` | candidate status | — | not a Center provider |

## 2. Meeting action ↔ Task

| Link / command | Source entity / service | Target entity / service | Company / project | Allowed actors | Authoritative fields | State mapping | Synchronous tx | Asynchronous effects | Unique / dedupe key | Read surfaces | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Action → Task conversion | `meeting_action_items` — M/meetings/meeting.actions.ts `convertActionToTask`, `createActionItem({createTask})` | `tasks` via `createTaskFromContextIn` (parent `meeting`) | action, meeting and task in one company; task project = the meeting's (validated) | `canConvertToTask` + `task.create`; assignee must pass the task door | `linkedTaskId` on the action; the Task owns status, assignee, due | action OPEN/IN_PROGRESS → task TODO/IN_PROGRESS; DONE/CANCELLED actions cannot convert | task + conditional claim `updateMany … linkedTaskId: null` + audit `MEETING_ACTION_TASK_CREATED` (+ task's own activity, `TASK_ASSIGNED` ob, watchers) | ob `TASK_ASSIGNED` | `meeting_action_items.linkedTaskId @unique`; a retry returns the existing authorised task (`created: false`) | meeting page actions, "My open actions", task page | api/meetings/meetings-service, api/meetings/aud10-meeting-task (CW-07), integration/integrity/workflow-consistency (`DUPLICATE_CONVERSION`) | implemented (fixed in AUD-10: retry-as-conflict, closed-action recheck, actor recheck (gaps 1, 4, 5, 6))|
| Task → action sync | `tasks` — every writer through M/tasks/task.mutation.ts `mutateTask` | `meeting_action_items` — M/meetings/meeting.task-sync.ts `syncActionFromTask` | same company | whoever may change the task (AUD-02) | Task `status`, `assigneeMemberId` | TODO→OPEN; IN_PROGRESS/BLOCKED→IN_PROGRESS; COMPLETED→DONE (server time); assignee (incl. null) → owner; ARCHIVED: no change (last mapped status kept), restore re-syncs; CANCELLED action: skipped | inside the task tx, after the task row lock, action `updateMany` guarded on the status read (`MEETING_ACTION_CHANGED`) | ob `MEETING_ACTION_COMPLETED` to the organizer (unless the organizer acted) | `perEvent` | meeting page, action lists, task page | api/tasks/task-reliability, api/meetings/aud10-meeting-task (CW-08..CW-10), integration/integrity/workflow-consistency (`ACTION_TASK_*_MISMATCH`) | implemented; completion activity via task path being added in AUD-10 (agent 3, gap 8) |
| Direct edit of a linked action | M/meetings/meeting.actions.ts `updateActionItem` | the action row | — | organizer / action managers; the owner for status of a standalone action | for a linked action: status, owner and due belong to the Task | refused with `ACTION_FOLLOWS_TASK` | locked row (`FOR UPDATE`) decides | ob `MEETING_ACTION_ASSIGNED` / `MEETING_ACTION_COMPLETED` for standalone actions only | `MEETING_ACTION_ASSIGNED:<actionId>:<member>:<eventId>` | meeting page | api/meetings/aud10-meeting-task (CW-11) | implemented (fixed in AUD-10: gaps 2, 3) |

## 3. Tasks raised from other records

All paths create the task through `M/tasks/task.service.ts` (`prepareTask` →
`writeTask`): module `tasks` + `task.create`, the parent resolved through the
record registry (archived parent refused), the task's project forced to the
parent's, activity `TASK_CREATED`/`TASK_ASSIGNED`, ob `TASK_ASSIGNED`
(dedupe `TASK_ASSIGNED:<task>:<member>:<assignmentVersion>`), watchers
subscribed — all in the task's tx.

| Link / command | Source entity / service | Link storage | Company / project | Allowed actors | Synchronous tx | Unique / dedupe key | Read surfaces | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Daily log → task | `daily_logs` + entry tables — M/daily-logs/daily-log.links.ts `createTaskFromLog` | `daily_log_task_links`; entry `linkedTaskId` on delay / instruction / work-activity entries | log's company and project | `daily_log.edit`, editable log, section rights | task + link + entry claim (conditional on `linkedTaskId` null) + log version + audit `DAILY_LOG_TASK_CREATED` | `@@unique([dailyLogId, taskId])`; entry claim | daily log page, task page | api/daily-logs/daily-logs, api/daily-logs/aud10-daily-log-task, integration/integrity/workflow-consistency (`ORPHANED_CONVERSION`) | implemented (fixed in AUD-10: gap 7) |
| Planning milestone → task | `project_milestones` — M/project-planning/planning.links.ts | `project_milestone_task_links` | project | `project_planning.milestone.edit` | task + link, milestone `FOR SHARE` | `@@unique([milestoneId, taskId])` | planning page, task page | api/project-planning/planning, api/project-planning/aud10-planning-task | implemented (fixed in AUD-10: gap 7) |
| Planning blocker → task | `project_milestone_blockers` — M/project-planning/planning.blockers.ts `createBlocker` | `linkedTaskId` + `project_milestone_task_links` (BLOCKS) | project | `project_planning.blockers.manage` | task + blocker + link + audit + ob `MILESTONE_BLOCKER_ASSIGNED` | link unique as above | planning page | api/project-planning/aud10-planning-task | implemented (fixed in AUD-10: gap 7) |
| Engineering / contractor record → task | work package, engineering document, submittal, RFI, contractor compliance — M/engineering/engineering.links.ts `createTaskFromRecord` | `tasks.entityType/entityId` only | record's project | the source's edit right + `task.create` (`ENGINEERING_TASK_FORBIDDEN`) | the task's own tx (no separate link row) | none needed | record page task list (`tasksFromRecord`) | api/engineering/engineering, api/tasks/aud10-task-from-record | implemented |
| Contract obligation → task | `contract_obligations` — M/contracts/obligations/obligation.service.ts `createTaskForObligation` | `tasks.entityType = obligation` | company (obligation has no project) | `legal.task.create`; obligation OPEN (`FOR SHARE`) | task in the obligation's tx | none | obligation page | api/contracts/contract-service, api/tasks/aud10-task-from-record | implemented (fixed in AUD-10: gap 7) |
| QA/QC corrective action → task | `corrective_actions` — M/qaqc/corrective-actions/action.service.ts `createActionTask` | `integration_links` (`QA_ACTION_TASK`) + task parent | project | `qaqc.task.create` | task + integration link + activity | `integration_links @@unique([companyId, integrationType, idempotencyKey])` | action page, task page | api/qaqc/qaqc-service | implemented |
| HSE action → task | `hse_actions` — M/hse/actions/action.service.ts `createTaskForAction` | `integration_links` (`HSE_ACTION_TASK`) + task parent | project | `hse.task.create` | task + integration link | as QA/QC | action page, task page | api/hse/hse-service | implemented |
| Generic "new task from this record" | any registered type — `lib/actions/tasks.ts` → `createTaskFromContext` | `tasks.entityType/entityId` | parent's | `task.create` + module grant for the parent | task tx | none | record task panels (`components/tasks/record-tasks.tsx`) | api/tasks/* | implemented |

## 4. Canonical record links and the record registry

`lib/core/records/record.registry.ts` resolves a `(type, id)` pair to the
owning module's record *as the reader may see it* (`loadRecord`,
`canReadRecord`, `reachableRecordKeys`), and to its route (`recordPath`).
Nothing builds a route from a display label.

| Consumer | Uses the registry for | Behaviour when the target is archived / missing / not readable | Tests | Status |
|---|---|---|---|---|
| Notification dispatch (`lib/core/notifications/notification.dispatch.ts`) | re-reads the record per recipient before a row is written | recipient skipped; event still settles (CW-15) | integration/delivery/outbox-delivery (CW-15), api/notifications/notification-authorization | implemented |
| Notification open / list (`lib/core/notifications/notification.service.ts` `openNotification`, `withdrawnNotificationIds`) | re-reads at the moment it is followed | missing or unreadable → `{ unavailable: true }`, list title `WITHDRAWN_TITLE`, body and href withheld; archived but readable → opens | api/collaboration/aud10-link-states (CW-19) | implemented |
| Attention items (`attention.service.ts`, `attention.reconcile.ts`) | readable filter, condition `holds` | not shown; reconciler resolves | api/jobs/attention.reconcile, integration/integrity/workflow-consistency (`STALE_PROJECTION`) | implemented |
| Comments, watchers, mentions (`lib/core/collaboration/collaboration.service.ts`) | parent readability (`readableParent`), `collaboration.requires` | `NOT_FOUND`; archived parent → `PARENT_ARCHIVED` on create | api/collaboration/collaboration-service | implemented |
| Task parent resolution (`M/tasks/task.service.ts` `resolveTaskParent`) | parent type + readability + project | refused before any write | api/tasks/* | implemented |
| Approvals Center (`approvals.cycle-provider.ts`, `approvals.documents.ts`) | record labels and links in the drawer | provider marks unreadable items; source links re-authorise | api/approvals/* | implemented (fixed in AUD-10: partial/unavailable providers) |
| Document parents (`M/documents/document.parent-access.ts`) | whether a document's parent admits the reader | document `DOCUMENT_NOT_FOUND` | api/documents/storage-pipeline, api/documents/aud10-shared-document | implemented |
| Cross-module link panels (daily logs, planning, engineering, contractors) | linked record summaries | unreadable links omitted | api/daily-logs, api/project-planning, api/engineering | implemented |
| Quick create (`M/quick-create/quick-create.service.ts`) | parent context | refused | api/quick-create | implemented |
| Search, favorites, recent work | **not** registry consumers: `lib/core/search/*` and `M/productivity/navigable.registry.ts` have their own readers | — | — | not supported (separate registry) |

## 5. Documents and attachments

One canonical `Document` (+ `DocumentVersion`s and one stored object per
version); links hold relation metadata only. A link grants nothing: access is
`findReadableDocument` (`M/documents/document.parent-access.ts`) →
module + `document.view` + the parent's own documents policy; download and
preview additionally need `document.download` and a readable object, and every
refusal is `DOCUMENT_NOT_FOUND` (existence is not confirmed).

| Link | Source / service | Target | Company / project | Allowed actors | Attach tx | Unlink | Unique | Read surfaces | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Unit document | `unit_document_links` — M/project-structure/unit-files.service.ts `attachUnitDocument` / `detachUnitDocument` | Document on the unit or its project | same company, same project (`CROSS_PROJECT_REFERENCE`) | `project.unit.documents.manage` | link + activity `UNIT_DOCUMENT_ATTACHED` + audit | deletes the link only; Document, object and other links stay | `@@unique([unitId, documentId])` | unit files panel | api/documents/aud10-shared-document (CW-14) | implemented |
| Unit media, Sales Plan | `unit_media`, `project_units.salesPlanDocumentId` — same file | image / PDF Document | as above | `project.unit.media.manage` / documents.manage | as above | media row only | `@@unique([unitId, documentId])`, `salesPlanDocumentId @unique` | unit page, publication snapshot (historical, frozen) | api/project-structure/* | implemented |
| Project media / cover | `project_media`, `projects.coverImageDocumentId` — M/project-media/project-media.service.ts | Document | project | project media manage | row | row only; cover cleared | `@@unique([projectId, documentId])` | project workspace | api/projects/* | implemented |
| Daily log evidence | `daily_log_document_links` — M/daily-logs/daily-log.links.ts `setEvidenceMeta` | Document uploaded with parent `daily_log` | log's company | `daily_log.edit` | upsert | no unlink service | `@@id([dailyLogId, documentId])`; Document/company FKs being added in AUD-10 (agent 3, gap 13) | daily log page | api/daily-logs/daily-logs | implemented (fixed in AUD-10) |
| Employee file | `employee_document_links` — M/hr/documents/employee-document.service.ts | Document | company; HR-private (policy) | HR permissions | link | status only (supersede/archive), never deleted | `@@unique([documentId, companyId])` | employee page | api/hr/* | implemented |
| Engineering revision, transmittal item, contractor compliance evidence | M/engineering/engineering.revisions.ts, engineering.transmittals.ts, M/contractors/contractor.compliance.ts | Document (frozen revision files) | project | engineering / contractor permissions | row | status only | per table | engineering pages | api/engineering/engineering | implemented |
| Any record's documents (parent pointer) | `documents.entityType/entityId` — upload pipeline `M/documents/storage/upload.service.ts` | — | parent's company/project | `canAttachToDocumentParent` | upload session + document | `archiveDocument` (status; links kept) | `storageKey @unique` | record documents panel | api/documents/storage-pipeline | implemented |
| Placeholder cleanup | M/documents/storage/cleanup.service.ts `runStorageCleanup` | abandoned first uploads | — | worker | DB decision first (document row `FOR UPDATE`), object after commit | removed only when nothing references it; any referencing row — found from the catalog's foreign keys plus the unconstrained references — keeps it and marks it FAILED | — | — | api/documents/aud10-cleanup-references, api/documents/storage-pipeline | implemented (AUD-10 gap 14, this change) |

## 6. Comments, watchers, mentions, activity

| Link / command | Service | Company / parent | Allowed actors | Synchronous tx | Asynchronous effects | Dedupe key | Mandatory vs optional history | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Comment on a record | `lib/core/collaboration/collaboration.service.ts` `createComment` | thread `@@unique([companyId, parentType, parentId])` on the canonical parent | `collaboration.comment.create` + parent readable (+ `collaboration.requires`, e.g. HR) | thread (ON CONFLICT) + comment + mentions + subscriptions + activity `COMMENTED` + audit `COMMENT_CREATED` + ob | ob `COMMENT_ADDED`, `COMMENT_REPLY`, `COMMENT_MENTIONED` | `COMMENT_*:<commentId>:<member>` — a duplicated event for one comment writes one notification | activity mandatory (in tx); HR threads write no activity | api/collaboration/collaboration-service | implemented |
| Mention | same, `validateMentions` | mentioned member must read the parent (`MENTION_NOT_ALLOWED`) | as above | as above | ob `COMMENT_MENTIONED` | as above | — | api/collaboration/collaboration-service | implemented |
| Watch / unwatch | `setWatching`, `subscribeStakeholdersIn` | parent readable | `collaboration.watch` | subscription upsert + activity | — | `@@unique([threadId, memberId])` | — | api/collaboration/collaboration-service | implemented |
| Business activity | `M/shared/activity.ts` `recordActivity` | row's company | the actor | always inside the caller's tx | — | — | mandatory: a failure fails the command | every service suite | implemented; `correlationId` written since AUD-10 (gap 9) |
| Audit | `lib/core/audit/audit.service.ts` `recordAuditEvent` | — | — | inside the caller's tx | — | — | `required` policies fail the command; optional ones run under a SAVEPOINT so their failure leaves the caller's tx usable (AUD-10 gap 12) | integration/delivery/optional-audit | implemented (this change) |

## 7. Notifications and delivery

| Stage | Where | Guarantee | Tests | Status |
|---|---|---|---|---|
| Intent | `enqueueNotificationEvent` (`notification.service.ts`) | written in the business tx; rolled back with it | integration/transactions/rollback | implemented |
| Claim | `claimOutboxBatch` | `FOR UPDATE SKIP LOCKED`; attempt counted at claim; expired lease re-claimed and recorded (`LEASE_EXPIRED` in `job_failures`) | integration/delivery/outbox-delivery (CW-16), api/jobs/notifications.dispatch | implemented |
| Recipient recheck | `dispatchOne` | live membership + permission + `loadRecord` per recipient at delivery | integration/delivery/outbox-delivery (CW-15) | implemented |
| Write | `prisma.notification.create` | `@@unique([companyId, recipientMemberId, dedupeKey])`; a replay finds the row and writes nothing | integration/delivery/outbox-delivery (CW-16, CW-17) | implemented |
| Email | `sendNotificationEmails` → `sendMail` | after the rows, never in a tx; idempotency key `notification:<id>`; memory sink in tests | integration/mail/mail-delivery | implemented |
| Terminal failure | `settleFailure`, `failAbandonedEvents` | `FAILED` + `lastErrorCode` + `attemptCount` + `failedAt`; history in `job_failures` | integration/delivery/outbox-delivery (CW-17) | implemented |
| Operator retry | `retryFailedNotificationEvents` (worker CLI only) | back to PENDING with fresh attempts; failure history marked `retriedBy`; the business operation is not redone | integration/delivery/outbox-delivery (CW-17) | implemented |
| Ordering | delivery never writes a business record | a late or reordered event cannot regress the record; notifications describe past transitions | integration/delivery/outbox-delivery (CW-17) | implemented |
| Overdue reminders | `TASK_OVERDUE` dedupe | a reopened, overdue-again task is told again | api/tasks/aud10-overdue-cycle | implemented (fixed in AUD-10: gap 11) |
| Payload content | producers | payloads still copy titles (task, meeting action) — delivered only after the recipient recheck; minimising them is a later change | — | untested (gap 15, not in AUD-10 scope of changes) |

## 8. Consistency verifier

`lib/core/integrity/workflow-consistency.ts`, run by
`scripts/verify-workflow-consistency.ts` (`verify:workflows`). Read-only (one
READ ONLY, REPEATABLE READ transaction), bounded ids and codes only, exits
non-zero on an error. Checks: linked action vs task status/owner/completion
time (§2 mapping; CANCELLED actions and ARCHIVED tasks excluded), duplicate
conversions (meeting actions, daily log entries), cross-company links (actions,
daily log and planning task links, document links, meeting-parented tasks,
approval cycles and reviews), approval source vs cycle for every provider with
a cycle table, more than one PENDING cycle per record, committed decisions and
task completions without their outbox event (7-day window, imported history
excluded), FAILED outbox events and stale attention items (warnings), and the
unique guards the checks rely on. Proved by
`tests/integration/integrity/workflow-consistency.test.ts` (CW-21).

## 9. Link-target index

Every record type registered in `lib/core/records/record.registry.ts`, with
the integrations above that target it. **Approval** names the provider(s);
**Docs** means documents may be filed on it (`uploadableRecordTypes`);
**Discussion** means comments/watchers/mentions (`collaboration` not null);
**Task parent** marks a dedicated task-from-record path in §3 (any type may
be a generic task parent). Every type is a notification-open / attention
target through the registry (§4).

| Record type | Module | Approval | Docs | Discussion | Task parent | Notes |
|---|---|---|---|---|---|---|
| `project` | projects | — | parent pointer | yes | — | project media, cover |
| `client` | clients | — | parent pointer | yes | — | |
| `task` | tasks | — | yes | yes | — | target of §2, §3 |
| `document` | documents | documents | — | yes | — | canonical file, §5 |
| `invoice` | finance | finance | yes | yes | — | |
| `payment` | finance | — | yes | no | — | |
| `expense` | finance | finance | yes | yes | — | |
| `budget` | finance | finance | yes | yes | — | |
| `commitment` | finance | finance | yes | yes | — | |
| `employee` | hr | — | yes | HR only (`hr.employee.update`) | — | |
| `employee_document` | hr | — | no | no | — | HR-private link, §5 |
| `person_qualification` | people | — | no | no | — | verify/reject not a provider |
| `leave_request` | hr | hr | yes | no | — | |
| `lead` | sales | — | yes | yes | — | |
| `opportunity` | sales | — | yes | yes | — | |
| `proposal` | sales | sales | yes | yes | — | accept/decline not a provider |
| `contract` | contracts | legal | yes | yes | — | |
| `amendment` | contracts | legal | yes | yes | — | |
| `obligation` | contracts | — | yes | yes | yes | |
| `purchase_request` | procurement | procurement | yes | yes | — | |
| `rfq` | procurement | — | yes | yes | — | |
| `purchase_order` | procurement | procurement | yes | yes | — | |
| `goods_receipt` | procurement | — | yes | yes | — | |
| `supplier` | procurement | — | yes | no | — | |
| `inventory_item` | inventory | — | yes | yes | — | |
| `warehouse` | inventory | — | no | no | — | |
| `inventory_receipt` | inventory | — | yes | yes | — | |
| `stock_issue` | inventory | — | yes | yes | — | |
| `stock_adjustment` | inventory | — | yes | yes | — | |
| `quality_inspection` | qaqc | qaqc | yes | yes | — | |
| `quality_defect` | qaqc | — | yes | yes | — | |
| `non_conformance_report` | qaqc | qaqc | yes | yes | — | |
| `corrective_action` | qaqc | — | yes | yes | yes | |
| `hse_inspection` | hse | hse | yes | yes | — | |
| `hazard` | hse | — | yes | yes | — | |
| `incident` | hse | hse | yes | yes | — | close approval |
| `risk_assessment` | hse | hse | yes | yes | — | |
| `hse_action` | hse | — | yes | yes | yes | |
| `toolbox_talk` | hse | — | yes | no | — | |
| `work_permit` | hse | hse | yes | yes | — | |
| `environmental_observation` | hse | — | yes | no | — | |
| `stop_work` | hse | — | no | no | — | |
| `calendar_event` | calendar | — | no | no | — | |
| `meeting` | meetings | — | yes | yes | yes | action ↔ task, §2 |
| `timesheet` | timesheets | timesheets | no | yes | — | |
| `daily_log` | dailyLogs | — | yes | yes | yes | review not a provider |
| `project_milestone` | projects | — | yes | yes | yes | blockers and links, §3 |
| `project_unit` | projects | projects, unit_sales | yes | no | — | §5 unit links |
| `announcement` | announcements | — | yes | no | — | |
| `contractor` | contractors | — | yes | yes | — | |
| `work_package` | contractors | — | yes | yes | yes | |
| `contractor_compliance` | contractors | — | yes | no | yes | |
| `engineering_document` | engineering | — | yes | yes | yes | revision review not a provider |
| `rfi` | engineering | — | yes | yes | yes | |
| `technical_submittal` | engineering | — | yes | yes | yes | |
| `transmittal` | engineering | — | yes | no | — | |
| `approval_delegation` | approvals | — | no | no | — | |
| `group_department` | organization | — | no | no | — | |

## 10. Not supported

Per AUD-10 §1, absent integrations stay absent: Microsoft 365 document
providers (the `externalProvider` columns are unwritten), a Sales →
Architecture claiming/review workflow, new approval policies or providers
(the decisions in §1's second table stay outside the Center), real-time
push (other tabs converge on refresh/focus/polling), an event bus or sagas,
offline queues. Search and favorites keep their own navigable registry (§4).
