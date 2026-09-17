# The unit page and publishing (E-05D)

Every unit E-05B created has one page, and that page is where the unit becomes
technically complete and approved for downstream use. Sales, Finance, the 3D
explorer and external publishing all read the same unit by its id, and — once
they exist — its **published version**, never a copy of the unit.

```
ONE UNIT · ONE UNIT ID · ONE UNIT PAGE · ONE LOGICAL SALES PLAN · ZERO DUPLICATION
```

```
DRAFT ──submit──→ READY_FOR_PUBLISHING ──publish──→ PUBLISHED ──publish (changes)──→ PUBLISHED v2, v3…
  │                     │                                │
  │                     └──request_revision──→ REVISION_REQUIRED ──submit──↗
  │                                                      ↑
  └────────────── publish (a publisher, directly) ───────┘   PUBLISHED ──request_revision──↗
                                                             PUBLISHED ──unpublish──→ READY_FOR_PUBLISHING
any working state ──archive──→ ARCHIVED ──restore──→ what it was (a waiting unit comes back as Draft)
```

Publishing status is **not** a sales status (§15). A Published unit is not
thereby For Sale: E-05E adds the commercial status beside it
(`docs/unit-sales.md`).

## Where things live

| Concern | Location |
| --- | --- |
| Types, labels, DTOs (client-safe) | `lib/modules/project-structure/unit-publishing.types.ts` |
| Readiness, display by kind of unit, snapshot, unpublished changes (pure, client-safe) | `lib/modules/project-structure/unit-publishing.rules.ts` |
| The state machine | `lib/modules/project-structure/unit-publication.machine.ts` (registered in `lib/core/state/registry.ts`) |
| What publishing reads about a unit, in one batched query; the drift refresh; the row lock | `lib/modules/project-structure/unit-publishing.state.ts` |
| Publishing requests (the Approvals Center's rows) | `lib/modules/project-structure/unit-publishing.requests.ts` |
| Submit, publish, revision, unpublish, archive, restore, history | `lib/modules/project-structure/unit-publishing.service.ts` |
| Sales Plan, documents, media | `lib/modules/project-structure/unit-files.service.ts` |
| Validation | `lib/modules/project-structure/unit-publishing.schema.ts` |
| Approvals Center provider | `lib/modules/approvals/providers/projects.provider.ts` (key `projects`, label *Unit publishing*) |
| Record registry | `project_unit` in `lib/core/records/record.registry.ts` — files filed on a unit are exactly as readable as the unit |
| API | `app/api/project-units/[unitId]/{publishing,submit-for-publishing,publish,revision-required,unpublish,archive,restore,publications/**,documents/**,document-candidates,sales-plan,media/**,activity}` |
| UI | `app/(nesto)/projects/[projectId]/units/[unitId]/**` (Overview, Documents, Media, Publishing, Activity), `components/project-structure/unit-page/*` |
| Demo data | `prisma/seed/unit-publishing.ts` |

## Data

Migration `20260917150000_unit_publishing_e05d`, purely additive. Every existing
unit starts **Draft** with no unpublished changes (§105); nothing is published by
a migration, and no unit held a Sales Plan or media before (§106).

- **ProjectUnit** gains `publicationStatus` (moved only by the machine),
  `preArchivePublicationStatus`, `publicationStatusChangedAt`,
  `currentPublicationId`, `hasUnpublishedChanges`, `revisionReason` and
  `salesPlanDocumentId` (unique: one logical Sales Plan per unit, one unit per
  Sales Plan).
- **UnitPublication** — `versionNumber` (unique per unit, ≥ 1), `publishedAt`,
  `publishedByMemberId`, `snapshot` (JSON), and the exact
  `salesPlanDocumentId`/`salesPlanDocumentVersionId` and
  `primaryMediaDocumentId`/`primaryMediaDocumentVersionId` it went out with.
  Written once, never updated.
- **UnitMedia** — a canonical Document shown as an image of the unit:
  `category` (Cover, Floor plan image, Interior render, Exterior render, View,
  Other), `caption`, `sortOrder`, `isPrimary`. Unique per unit and document.
- **UnitDocumentLink** — a canonical Document attached to the unit, with its
  `category` (Technical drawing, Specification, Other attachable now; Sales Plan
  is the unit's own pointer; Contract, Finance and Legal wait for E-05F).
- **UnitPublicationApproval** — one row per request to publish, read by the
  Approvals Center (`PENDING`, `APPROVED`, `RETURNED`, `CANCELLED`; `REJECTED`
  exists for the cycle contract and is never written).

Held by the database, not only the service:

| Rule | How |
| --- | --- |
| A publication, image or document link belongs to its unit's project and company | composite FK `(unitId, projectId, companyId)` → unit `(id, projectId, companyId)` |
| A unit's current version is one of its own | composite FK `(currentPublicationId, id)` → publication `(id, unitId)` |
| At most one primary image per unit | partial unique index on `unit_media(unitId) WHERE isPrimary` |
| At most one open request per unit | partial unique index on `unit_publication_approvals(recordId) WHERE status = 'PENDING'` |
| Two publishes cannot write the same version | unique `(unitId, versionNumber)` |

Nothing copies a unit, a file or a client. Media and document links point at
Documents; publications hold the approved *facts* and the ids of the exact file
versions, not the files.

## Rules

| Rule | Where |
| --- | --- |
| A unit is submitted and published only when complete: code, type, building and floor, its primary area (saleable; for parking and storage any of saleable, internal or gross; for land saleable or gross), for a residential unit bedrooms, bathrooms and orientation, an available PDF Sales Plan, an available primary image, the unit active, and no attached file archived or unavailable (§16, §17) | `evaluateReadiness`, checked again under the unit's row lock |
| An incomplete unit is refused with what is missing — *This unit cannot be published. Missing: Sales Plan, Primary image.* — and the page explains instead of greying the button (§46, §81) | `UNIT_NOT_READY` (422, `details.missing`); the not-ready dialog |
| Submitting a draft or a unit sent back makes it Ready for Publishing and opens one request; a published unit with unpublished changes stays Published and opens a request for its changes | `submitUnitForPublishing` |
| Publishing locks the unit, validates again, writes the next version with the exact Sales Plan and image versions, points the unit at it, clears unpublished changes and the revision reason, and closes the open request — all or nothing (§23, §66, §82) | `publishUnit` |
| A publisher may publish a unit without waiting for a request | the machine's `publish` is legal from Draft and Revision Required |
| Republishing with nothing changed is refused; if the changes were reverted while a request was open, the request is settled against the live version | `UNIT_NO_UNPUBLISHED_CHANGES` |
| Revision Required needs a reason (§22, §67). On a waiting unit it sends the unit back; on a published unit whose changes are waiting it returns the changes and keeps the live version; on a published unit with nothing waiting it takes the unit out of use | `requestUnitRevision` |
| Unpublishing needs a reason and returns the unit to Ready for Publishing, with a request open so it is visibly waiting (§31, §68) | `unpublishUnit` |
| Archive keeps everything and cancels an open request; restore returns to the state before, except that a waiting unit comes back as Draft (§32) | `archiveUnit`, `restoreUnit` |
| Every transition carries the version the person saw: *This unit was updated by another user. Refresh before continuing.* (§54) | `STRUCTURE_STALE` |
| **Unpublished changes** (§27-§30): a published unit differs from its current version when its code, name, type, building, floor, position, orientation, any area, room counts, attributes, technical notes, Sales Plan version or primary image (or its version) differ. Renaming a building or a unit type is not a change to the unit. Putting a value back is no change | `publishFingerprint`; the flag is refreshed inside every edit, move, floor move, Sales Plan version and primary change, and recomputed on the page |
| One logical Sales Plan (§33-§36, §78): the first PDF uploaded to the unit becomes it; a later upload is a new version of the same document. A second, different document is refused — *Upload the new file as a new version of it.* A publication keeps the version it went out with | `setUnitSalesPlan`, `UNIT_SALES_PLAN_EXISTS` |
| A document attached to a unit is one of the unit's own or one filed on its project — a typical floor plan is attached to many units and never copied; another project's is a 422 on `documentId` (§63, §100) | `attachUnitDocument`, `CROSS_PROJECT_REFERENCE` |
| Media are JPEG, PNG or WebP. The first image becomes primary; choosing another clears the old one in the same transaction (§42, §76). Removing the primary leaves none | `addUnitMedia`, `updateUnitMedia` |
| A unit with a publication, a Sales Plan, media, links, files or a request is not deleted — it is archived or deactivated (E-05B §56) | `UNIT_REFERENCED` |
| A unit on sale — For Sale, On Hold, Reserved or Sold — is not unpublished, sent back from Published, or archived until Sales takes it off sale (E-05E §35, `docs/unit-sales.md`) | `assertNotOnSale`; `UNIT_ON_SALE` |

The snapshot keeps exactly: code, name, type (id, name, category), building (id,
name, code), floor (id, name, number, level), position, orientation, the eight
areas as two-decimal strings, rooms, bedrooms, bathrooms, attributes, technical
notes, and the Sales Plan and primary image references (§73). Nothing about who
edited what, and nothing internal.

## Authorisation (§18-§20, §85-§89, §99-§104)

Every read and write goes through the unit's project door first (E-05B): a unit,
publication, image or link id from a project the person cannot open is a 404
that names nothing. Then the action's permission — never a role name.

| Permission | What it allows |
| --- | --- |
| `project.structure.view` | The unit page (E-05B) |
| `project.unit.publication_history.view` | Published versions and their snapshots |
| `project.unit.documents.manage` | The Sales Plan and attached documents; uploading files to the unit |
| `project.unit.media.manage` | Images: add, caption, categorise, order, choose the primary, remove |
| `project.unit.submit_for_publish` | Submit the unit, or its changes, for review |
| `project.unit.publish` | Publish (and approve a request in the Approvals Center) |
| `project.unit.revision_request` | Revision Required, and Return in the Approvals Center |
| `project.unit.unpublish` | Take a published unit back to Ready for Publishing |
| `project.unit.archive` | Archive and restore |

| Role | Read | Prepare & submit | Publish, revision, unpublish, archive |
| --- | --- | --- | --- |
| Owner | yes | yes | yes |
| Admin | yes | yes (override) | yes (override) |
| Architecture Manager | every project of the company | yes (override) | yes (override) |
| Project Manager | own projects | yes (MANAGE rung) | no |
| Architect | assigned projects | yes (override) | no |
| Engineer, Sales, Sales Manager, Finance, Legal, CEO, others | in their scope | no | no |
| Viewer | assigned projects | no | no |

Files follow the Documents module's own gate (§88, §102): the Documents and Media
sections appear only with the Documents module and `document.view`, a file is
listed only when `buildDocumentAccessWhere` lets the reader open it, uploads need
`document.create` and `project.unit.documents.manage`, a new Sales Plan version
`document.update` as well, and thumbnails and previews go through the download
gate after the unit's door. Hiding a section is never the protection; every API
repeats the check.

The **Architecture Manager** and **Sales Manager** roles are new with this
enhancement. The Architecture Manager holds the Architect's row across every
project of the company plus publishing, the approvals inbox, and no project
creation or status authority (E-05A §8, §58); the Sales Manager holds the Sales
row and decides proposals, which Sales may not (E-05E §39 builds on it).

## API

| Method and path | Does |
| --- | --- |
| `GET /api/project-units/:unitId/publishing` | Status, current version, unpublished changes, revision reason, the open request, readiness, capabilities |
| `POST …/submit-for-publishing` | `{ expectedVersion }` |
| `POST …/publish` | `{ expectedVersion?, note? }` → `{ status, version, publicationId, versionNumber, alreadyPublished }` |
| `POST …/revision-required` | `{ reason, expectedVersion? }` → `{ status, version, returnedChangesOnly }` |
| `POST …/unpublish` | `{ reason, expectedVersion }` |
| `POST …/archive`, `POST …/restore` | `{ expectedVersion }` |
| `GET …/publications`, `GET …/publications/:publicationId` | History, newest first; one version with its snapshot |
| `GET …/documents` | Sales Plan, links, media and unfiled uploads the reader may open, with capabilities |
| `POST …/documents`, `DELETE …/documents/:linkId` | `{ documentId, category }`; removing a link keeps the document |
| `GET …/document-candidates?kind=document\|image&q=` | Files of this unit or its project that could be attached |
| `POST …/sales-plan` | `{ documentId }` — make an uploaded PDF the Sales Plan, or record its new version |
| `GET …/media`, `POST …/media` | `{ documentId, category?, caption? }` |
| `PATCH …/media/:mediaId`, `DELETE …/media/:mediaId`, `POST …/media/reorder` | `{ category?, caption?, isPrimary: true }`; `{ ids }` naming every image once |
| `GET …/media/:mediaId/thumbnail` | The image's thumbnail, `private` cache |
| `GET …/activity` | The unit's history |

Files themselves are uploaded through the Documents API with the unit as their
parent (`context: "record"`, `entityType: "project_unit"`), and new versions
through `/api/documents/:id/versions/*`. There is no unit file storage.

Paths follow E-05B's `/api/project-units/...` rather than the PRD's `/api/units`.
The unit read stays `GET /api/project-units/:unitId`, and the unit list takes
`publicationStatus` and `unpublishedChanges=true`.

## Approvals Center

Provider `projects`, label *Unit publishing*, record type `project_unit`. A
pending request shows the unit, its floor and project, its published version and
readiness, with a warning when it cannot be published yet. **Approve** publishes
through `publishUnit`; **Return** is Revision Required through
`requestUnitRevision` with the reviewer's note. There is no Reject: a unit that is
not right goes back to be corrected. A publisher may approve their own
submission (`selfPermission: project.unit.publish`), as they could publish
directly. Requests notify everybody who holds `project.unit.publish` and can open
the unit, raise `PENDING_APPROVAL` attention, and are resolved by the decision.

## Audit and activity (§48, §49, §83, §84)

Audit: `PROJECT_UNIT_DOCUMENT_LINKED` / `_UNLINKED`,
`PROJECT_UNIT_SALES_PLAN_CHANGED`, `PROJECT_UNIT_MEDIA_CHANGED` (`change`:
ADDED, UPDATED, PRIMARY, REMOVED, REORDERED), `PROJECT_UNIT_PUBLICATION_STATUS_CHANGED`
(submit, revision, returned changes, restore), `PROJECT_UNIT_PUBLISHED` (version,
publication, file versions), `PROJECT_UNIT_UNPUBLISHED` (with reason, `CRITICAL`),
`PROJECT_UNIT_ARCHIVED`, plus the `APPROVAL_*` events of the request. All written
in the transaction of the change.

Activity on the unit's own history (the Activity section): created, updated,
code changed, moved, Sales Plan added and new versions, documents attached and
removed, images added, updated, reordered, removed and made primary, submitted,
revision required, changes returned, published (with its version), unpublished,
archived and restored.

## Screens

**The unit page** `/projects/:projectId/units/:unitId` keeps E-05B's breadcrumb —
Projects / company / project / building / floor / code — and header: the code,
the type, the publication badge (*Published v3*), *Unpublished changes*, *Waiting
for review* and *Inactive* where they apply, the location, and the actions the
reader may take: **Submit for Publishing** / **Submit changes**, **Publish** /
**Publish changes**, **Revision Required** / **Return changes**, a menu with
Unpublish, Archive and Restore, and E-05B's Edit, Move and delete. Below the
project tabs, the unit's sections are routes:

- **Overview** — technical data by kind of unit (a parking space shows no
  bedrooms unless somebody entered them), areas, the primary image (first on a
  phone), the Sales Plan and the readiness checklist (*6 / 7 required items
  complete*).
- **Documents** — the Sales Plan (upload, upload a new version, its versions in
  Documents), technical documents (upload with a category, attach an existing
  project document, remove), and any upload nothing points at yet.
- **Media** — the images in order, the primary marked; make primary, edit
  category and caption, move earlier or later, remove, view whole. Upload or add
  from the project.
- **Publishing** — the reviewer's view: status, current version and who published
  it, who submitted and when, the revision reason, the unpublished-changes note,
  readiness, and the publication history linking to each version's snapshot.
- **Activity** — the unit's history.

The unit edit dialog asks before discarding unsaved changes, and warns on leaving
the page (§53). The unit list has a Publication column (with *Changed*) and a
Publication filter, and a phone card shows the badge.

No `loading.tsx` is added under the unit: a loading boundary would turn the page
guards' redirects into client navigations inside a 200 (see
`app/(nesto)/dashboard/loading.tsx`). Images load lazily through preview grants,
with the thumbnail as the placeholder.

## Seed

Riverside Residences, Block A, Floor 1: **A-101** Published v1 (Sales Plan, a
floor plan image as primary, an exterior render, an electrical layout);
**A-102** Published v2 with its saleable area corrected since and the change
waiting for review; **A-103** Ready for Publishing; **A-104** Revision Required
with the reviewer's reason; **B-101** Draft with a Sales Plan; **A-201** to
**A-204** Published v1 with a Sales Plan and a floor plan each, the stock E-05E's
seed sells. Company B's
**OF-001** is Published v1 with its own files, so isolation has something to
refuse in both directions. The Architecture Manager's inbox holds the two
requests.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/project-structure/publishing-rules.test.ts` | Readiness by kind of unit, hints and order; display; the snapshot's fields; what counts as an unpublished change; the machine's moves; validation; role defaults for every E-05D permission |
| `tests/api/project-structure/unit-publishing.test.ts` | Readiness refusals; submit and one request under a race; v1 with exact file versions; unpublished changes from an edit, a revert and a move; v2; two publishers racing; readiness re-checked at publish; revision with reasons, returned changes, unpublish, archive and restore; one logical Sales Plan and its versions; project drawings attached to many units, another project's refused; archived attachments in readiness; media primary swap, the partial index, order and removal; Architect/Architecture Manager/Owner/Admin/PM/Sales/Finance capabilities; outsiders and Company B get 404; the unit list filter; the Approvals Center approving and returning |
| `tests/security/*` | Every new route swept both ways between companies (34 attempts each, all 404); `linkId`, `mediaId` and `publicationId` resolve to real rows of the unit they belong to |
| `tests/e2e/modules/unit-publishing.spec.ts` | The Architect uploads a Sales Plan and an image and submits; the Architecture Manager publishes; an edit shows as unpublished changes while v1 keeps its area; Sales reads with no actions; Publish on an incomplete unit explains what is missing; the seeded states in the unit list |
| `tests/e2e/responsive/project-structure-mobile.spec.ts` | A published unit's page, sections, Sales Plan and history on a phone, without horizontal scroll |

## Limits

- **No field-level diff** between versions (§51 does not require one): each
  version's snapshot is shown whole.
- **The stored `hasUnpublishedChanges` flag** is refreshed by every write that
  can change it. A Sales Plan version promoted later by the scan worker is seen
  on the unit page at once (it recomputes) but reaches the unit list's flag only
  with the next write to the unit or the next "record new version" call the
  Documents section makes after an upload.
- **Publication requirements are fixed per kind of unit**; a project or company
  setting for them (§16 "future configuration") is not built.
- **Publishing is per unit.** No bulk submit or publish.
- **Unit page sections are English**, like every module page; the two new roles
  are named in Albanian as well.
- **Sales has its own section** on the unit page since E-05E, with its own
  contract in `docs/unit-sales.md`.
