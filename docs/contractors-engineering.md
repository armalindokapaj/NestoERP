# Contractors, Engineering & Legal Integration (PRD #46)

The internal contractor foundation and the technical record of every project.
NESTO V0.1 is operated by the company alone: contractors are organisations and
contact records, never users, and nothing here accepts an external or
anonymous request.

```
Contractor organisation      ≠ CompanyMember · ≠ Supplier (linked when it also sells) · no login in V0.1
  ↓ Project assignment        one per project: status, scope, contract (Legal), internal manager, contact
  ↓ Work package              scope unit: contractor, contract, dates, value in context
  ↓ Engineering / Legal       documents & drawings, revisions, RFIs, submittals, transmittals · contracts stay in Legal
Tasks · Meetings · Daily logs · QA/QC · HSE · Procurement — linked, never mutated
```

## Where things live

| Concern | Location |
| --- | --- |
| Vocabulary and DTOs | `lib/modules/contractors/contractor.types.ts`, `lib/modules/engineering/engineering.types.ts` |
| Validation | `lib/modules/contractors/contractor.schema.ts`, `lib/modules/engineering/engineering.{fields,schema}.ts` |
| Doors (company, module, permission, project scope) | `lib/modules/contractors/contractor.permissions.ts`, `lib/modules/engineering/engineering.permissions.ts` |
| Directory, duplicates, archive and reactivation | `lib/modules/contractors/contractor.service.ts`, `contractor.names.ts` |
| Contacts | `lib/modules/contractors/contractor.contacts.ts` |
| Project assignments | `lib/modules/contractors/contractor.assignments.ts` |
| Contract linkage and the legal summary | `lib/modules/contractors/contractor.commercial.ts` |
| Compliance; job `contractors.compliance` | `lib/modules/contractors/contractor.compliance.ts` |
| Work packages | `lib/modules/work-packages/work-package.service.ts` |
| Shared checks, people, numbering | `lib/modules/engineering/engineering.shared.ts` |
| Register (documents and drawings) | `lib/modules/engineering/engineering.documents.ts` |
| Revisions and reviews (documents and submittals), frozen files | `lib/modules/engineering/engineering.revisions.ts` |
| RFIs, responses, references | `lib/modules/engineering/engineering.rfis.ts` |
| Submittals (incl. method statements and materials) | `lib/modules/engineering/engineering.submittals.ts` |
| Transmittals | `lib/modules/engineering/engineering.transmittals.ts` |
| Links and tasks | `lib/modules/engineering/engineering.links.ts` |
| Attention collectors; job `engineering.reminders` | `lib/modules/engineering/engineering.attention.ts` |
| Overview, my work, widgets, reports | `lib/modules/engineering/engineering.overview.ts` |
| Calendar providers `rfis`, `submittals`, `contractor-compliance` | `lib/modules/engineering/engineering.calendar-provider.ts` |
| Settings | `lib/modules/engineering/engineering.settings.ts` |
| API | `app/api/contractors/**`, `contractor-contacts`, `contractor-compliance`, `project-contractor-assignments`, `work-packages`, `engineering-documents`, `engineering-document-revisions`, `rfis`, `submittals`, `submittal-revisions`, `transmittals`, `engineering/{my-work,reports,settings}`, `projects/:id/{contractors,work-packages,engineering,rfis,submittals,transmittals}` |
| UI | `app/(nesto)/contractors/**`, `app/(nesto)/engineering/**`, `app/(nesto)/projects/:id/{contractors,work-packages,engineering}/**`, `components/contractors/*`, `components/engineering/*` |

## Modules and permissions

Two switchable modules, `contractors` and `engineering` (on or off per company
in Settings → Modules).

| Family | Permissions |
| --- | --- |
| Contractors | `contractor.view/create/edit/archive`, `contractor_contact.view/manage`, `project_contractor.view/manage`, `work_package.view/create/edit/complete`, `contractor_compliance.view/manage/waive` |
| Engineering | `engineering_document.view/create/edit/submit/review/approve`, `rfi.view/create/edit/open/respond/close/void`, `submittal.view/create/edit/submit/review/approve`, `transmittal.view/create/issue/void`, `engineering.settings.manage` |

| Role | Contractors | Engineering |
| --- | --- | --- |
| Owner | Manage | Manage |
| Admin | View | — |
| Company IT, HR, Sales | — | — |
| CEO | View | View |
| Project Manager | Manage (project scope) | Approve, plus void RFIs and transmittals |
| Architect, Engineer | View | Approve (review, approve, close RFIs, issue transmittals) |
| Finance | View | — |
| Legal | View, plus compliance manage and waive | — |
| Procurement | View | View |
| Inventory | — | View |
| QA/QC | View | View, plus submittal review/approve and document review |
| HSE | View | View, plus submittal review/approve |
| Viewer | View (assigned projects) | View (assigned projects) |

The contractor directory is company master data: readers with company or
project scope see all of it; assigned-scope readers see contractors on their
projects and ones they added. Assignments, work packages and every engineering
record are reached only through the reader's project door — a guessed id on
another project answers exactly like one that does not exist.

## Rules

| Rule | Code |
| --- | --- |
| A likely duplicate (normalised name, registration, VAT, email domain, supplier) is refused until confirmed; never merged | `CONTRACTOR_DUPLICATE` |
| A supplier, contract, contact, member, work package and document must be this company's, and on this project where it has one | `CONTRACTOR_SUPPLIER_INVALID`, `CONTRACT_INVALID`, `CONTRACT_PROJECT_MISMATCH`, `ASSIGNMENT_CONTACT_INVALID`, `ENGINEERING_MEMBER_INVALID`, `ENGINEERING_WORK_PACKAGE_PROJECT_MISMATCH`, `ENGINEERING_LINK_PROJECT_MISMATCH`, `RFI_REFERENCE_PROJECT_MISMATCH`, `TRANSMITTAL_ITEM_PROJECT_MISMATCH` |
| A contractor with live assignments is not archived; archived or offboarded comes back only with a reason | `CONTRACTOR_HAS_LIVE_ASSIGNMENTS`, `CONTRACTOR_NOT_CLOSED` |
| One assignment per project; termination keeps history and stops new work naming that contractor there | `CONTRACTOR_ALREADY_ASSIGNED`, `ENGINEERING_ASSIGNMENT_TERMINATED` |
| Engineering records name a contractor assigned to the project; a work package lends its contractor | `ENGINEERING_CONTRACTOR_NOT_ASSIGNED`, `ENGINEERING_CONTRACTOR_MISMATCH` |
| Numbers are unique per project: the company scheme when automatic, a typed number, else `WP-001`, `RFI-001`, `SUB-001`, `TRN-001` | `WORK_PACKAGE_CODE_TAKEN`, `RFI_NUMBER_TAKEN`, `SUBMITTAL_NUMBER_TAKEN`, `TRANSMITTAL_NUMBER_TAKEN`, `ENGINEERING_DOCUMENT_NUMBER_TAKEN` |
| Work package value is shown and set only with Legal or Finance access; completing it closes nothing else | `WORK_PACKAGE_VALUE_FORBIDDEN` |
| Compliance: VALID or MISSING by a person, EXPIRING and EXPIRED from the dates; a waiver needs its grant and a reason | — |
| One revision in progress at a time; revision codes unique per record; a revision's file is a Document on the record, not carried by another revision | `REVISION_IN_PROGRESS`, `REVISION_CODE_TAKEN`, `REVISION_FILE_INVALID`, `REVISION_FILE_IN_USE` |
| A submitted revision's file is frozen — a new version is refused; so is a file on an issued transmittal | `ENGINEERING_FILE_FROZEN` |
| The submitter does not review their own revision (unless the company allows it); an assigned revision is decided by its reviewer or an approver; anything short of approval needs a comment | `REVIEW_SELF_FORBIDDEN`, `REVIEW_NOT_ASSIGNED` |
| Approval supersedes every older revision and makes the approved one current | — |
| RFI: `DRAFT → OPEN → ANSWERED → CLOSED`, `ANSWERED → CLARIFICATION_REQUIRED → ANSWERED`, void with a reason; the question is fixed once open; responses are added, never edited; the assignee or a closer answers | `RFI_QUESTION_LOCKED`, `RFI_NOT_ASSIGNED`, `RFI_NOT_ANSWERED`, `RFI_CLOSED` |
| Transmittal: `DRAFT → ISSUED → VOID`; issuing snapshots each file version; an issued transmittal never changes | `TRANSMITTAL_ISSUED_LOCKED` |
| Updates never change status — every transition is its own command | schema |

**Boundaries.** Approving a material submittal creates no purchase order and
no stock; approving a method statement changes no HSE or QA/QC record;
completing a task closes no RFI; an RFI is not a legal notice or a claim.
Links are integration links of type `ENGINEERING_RECORD`; each reader sees only
the linked records they could open themselves. Contract numbers and values
appear only where Legal (or Finance, for values) would show them.

**Documents.** Every file is a canonical Document on its record
(`contractor`, `contractor_compliance`, `work_package`, `engineering_document`,
`rfi`, `technical_submittal`, `transmittal`). `Document.sharingClassification`
(`INTERNAL_ONLY` by default, `EXTERNAL_SHAREABLE`, `EXTERNAL_SHARED`,
`CONTRACTOR_SUBMITTED`) is metadata for a V0.2 portal and opens nothing today.

## Notifications, attention, jobs

| Event | To |
| --- | --- |
| `CONTRACTOR_ASSIGNED_TO_PROJECT` | Project manager, internal manager |
| `CONTRACTOR_STATUS_CHANGED` | Internal managers and project managers of live assignments |
| `CONTRACTOR_COMPLIANCE_EXPIRING`, `…_EXPIRED` (once per expiry date) | Compliance owners, managers of live assignments |
| `RFI_OPENED`, `RFI_ASSIGNED`, `RFI_DUE_SOON`, `RFI_OVERDUE`, `RFI_ANSWERED`, `RFI_CLARIFICATION_REQUIRED`, `RFI_CLOSED` | Project manager, assignee, raiser |
| `SUBMITTAL_SUBMITTED`, `SUBMITTAL_REVIEW_ASSIGNED`, `SUBMITTAL_DUE_SOON`, `SUBMITTAL_OVERDUE`, `SUBMITTAL_APPROVED`, `SUBMITTAL_REVISION_REQUIRED`, `SUBMITTAL_REJECTED` | Reviewer (or project manager), submitter, creator |
| `ENGINEERING_DOCUMENT_SUBMITTED`, `…_APPROVED`, `…_REVISION_REQUIRED` | Reviewer (or project manager), submitter, responsible |
| `TRANSMITTAL_ISSUED` | Project manager, creator, responsible for each document |

Attention: `CONTRACTOR_COMPLIANCE_EXPIRING`, `CONTRACTOR_COMPLIANCE_EXPIRED`
(not dismissible), `CONTRACTOR_COMPLIANCE_MISSING`, `RFI_OVERDUE`,
`RFI_RESPONSE_REQUIRED`, `SUBMITTAL_REVIEW_OVERDUE`,
`SUBMITTAL_REVISION_REQUIRED`, `ENGINEERING_REVIEW_OVERDUE` — each resolved as
soon as the answer, decision, renewal, waiver or void ends it. Jobs:
`engineering.reminders` (hourly) and `contractors.compliance` (daily).

## Integrations

- **Record registry** — the seven record types above: files through the
  canonical pipeline, discussion on contractors, work packages, documents,
  RFIs and submittals.
- **Daily logs** — workforce entries and work activities take a contractor and
  work package of the log's project. There is no separate contractor diary.
- **Search** — contractor legal/trading name, registration, VAT; work package
  code and name; RFI number and subject; submittal number and title; document
  number and title; transmittal number.
- **Calendar** — category `ENGINEERING` (RFI response and submittal review due
  dates) and `LEGAL` (compliance expiries).
- **Dashboards** — `rfisAssignedToMe`, `reviewsAwaitingMe` (Engineer,
  Architect, QA/QC, HSE), `engineeringBottlenecks` and `contractorCompliance`
  (Owner, CEO, Project Manager; compliance for Legal).
- **Project** — Contractors and Engineering tabs on every project page.
- **Numbering** — schemes `contractors:work_package`, `engineering:rfi`,
  `engineering:technical_submittal`, `engineering:transmittal`.
- **Audit** — categories `CONTRACTOR` and `ENGINEERING`; identifiers and
  decisions, never RFI text, legal notes or review comments.

## Experience

- `/contractors` — directory with status, active projects, work packages, open
  RFIs, submittals and compliance alerts; Work Packages and Compliance
  sections. New contractor with duplicate warnings.
- `/contractors/:id` — header counts, then Overview, Projects, Work packages,
  Contracts (Legal readers), Engineering, Compliance (renew, upload evidence,
  waive), Documents, Contacts, Activity.
- `/projects/:id/contractors` — assignments with contract, manager and open
  actions; work packages; compliance alerts. `/projects/:id/work-packages/:wp`
  — scope, dates, value in context, links, tasks, files, discussion.
- `/projects/:id/engineering` — headline (open RFIs • under review • revision
  required), section column, dashboard; Drawings, Engineering docs, RFIs,
  Submittals, Method statements, Material submittals, Transmittals registers;
  record pages with the revision timeline and review decision bar, the RFI
  thread and composer, links and tasks, files and discussion. Registers become
  cards on a phone.
- `/engineering` — My Work (RFIs to answer, reviews assigned, RFIs to close),
  company-wide registers, Reports (counted, never scored), Settings.

## Seed

Company A: Apex Structural Works (linked to the Alba Concrete supplier) on
Riverside and planned for Central Office Tower; Brightline Façades on the
Riverside façade subcontract with its bond expired and ISO 45001 missing;
Northgate MEP prospective; Ironbridge Groundworks offboarded after a terminated
assignment. Riverside has ARC-SD-023 through revisions A, B and C,
STR-CALC-011 overdue for the Engineer's review, FAC-SD-004 under the Architect's
review, RFIs open and overdue, answered, closed and draft, SUB-001 sent back for
revision, a crane method statement with HSE, approved rebar certificates, and
an issued and a draft transmittal. Company B has one contractor.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/engineering` | Names, compliance derivation, schemas without state changes, revision codes and review comments, role defaults for every role |
| `tests/api/engineering/contractors.test.ts` | Directory, duplicates, supplier and company isolation, archive and reactivation, contacts, assignments and termination, work packages, compliance worker, attention and waiver, legal and finance boundaries |
| `tests/api/engineering/engineering.test.ts` | Register uniqueness and same-project links, revisions A→B→C with supersession, frozen files, self-review and assigned review, RFI lifecycle and references, IDOR, tasks, submittals with no procurement or stock effect, method statement links to HSE, transmittals, daily log context, search, calendar, notifications, attention, reminders, overview and reports |
| `tests/e2e/modules/contractors-engineering.spec.ts` | Contractor setup, RFI, submittal, drawing revisions, compliance renewal |
| `tests/e2e/responsive/engineering-mobile.spec.ts` | Engineer answers an RFI and reviews a submittal on a phone |
| `tests/perf/engineering.perf.test.ts` | Contractor list, project registers, RFI and submittal detail at volume (`NESTO_PERF=1`) |
