# The unit page and publishing (E-05D; publish on create, 2026-11)

Every unit E-05B created has one page. Sales, Finance, the 3D explorer and
external publishing all read the same unit by its id, and its **published
version**, never a copy of the unit.

```
ONE UNIT · ONE UNIT ID · ONE UNIT PAGE · ONE LOGICAL SALES PLAN · ZERO DUPLICATION
```

Since 2026-11 (owner's decision) a unit is **published the moment it is
created**, whatever its completeness, and **every change to what it publishes
goes out at once** as its next version. There is no Submit, no review, no
"unpublished changes", no Revision Required and no Unpublish. Archive is the
only way out of use.

```
create ──→ PUBLISHED v1 ──(any change to a publish fact)──→ PUBLISHED v2, v3 …
               │                                    ↑
               └──archive──→ ARCHIVED ──restore─────┘  (next version if it changed meanwhile)
```

Publishing status is **not** a sales status (§15). A Published unit is not
thereby For Sale: Sales adds the commercial status beside it
(`docs/unit-sales.md`); a unit on sale cannot be archived.

## Where things live

| Concern | Location |
| --- | --- |
| Types, labels, DTOs (client-safe) | `lib/modules/project-structure/unit-publishing.types.ts` |
| Display by kind of unit, the checklist, the snapshot and its fingerprint (pure, client-safe) | `lib/modules/project-structure/unit-publishing.rules.ts` |
| The state machine (archive, restore) | `lib/modules/project-structure/unit-publication.machine.ts` (registered in `lib/core/state/registry.ts`) |
| What publishing reads about a unit, in one batched query; **`publishLiveUnits`**; the Documents door; the row lock | `lib/modules/project-structure/unit-publishing.state.ts` |
| Reads, archive, restore, history | `lib/modules/project-structure/unit-publishing.service.ts` |
| Sales Plan, documents, media | `lib/modules/project-structure/unit-files.service.ts` |
| Record registry | `project_unit` in `lib/core/records/record.registry.ts` |
| API | `app/api/project-units/[unitId]/{publishing,archive,restore,publications/**,documents/**,document-candidates,sales-plan,media/**,activity}` |
| UI | `app/(nesto)/projects/[projectId]/units/[unitId]/**` (Overview, Documents, Media, Publishing, Activity), `components/project-structure/unit-page/*` |
| Demo data | `prisma/seed/unit-publishing.ts` |

## Data

- **ProjectUnit** — `publicationStatus` (set to `PUBLISHED` at creation, moved
  afterwards only by the machine), `preArchivePublicationStatus`,
  `publicationStatusChangedAt`, `currentPublicationId` (always the latest
  version of a unit in use), `salesPlanDocumentId` (unique: one logical Sales
  Plan per unit). `hasUnpublishedChanges` and `revisionReason` belong to the
  retired review and stay `false` / null.
- **UnitPublication** — `versionNumber` (unique per unit, ≥ 1), `publishedAt`,
  `publishedByMemberId` (**null = published automatically**: the 2026-11
  backfill, a unit a Platform Admin made in the 3D tool, a file version the scan
  worker promoted), `snapshot` (JSON) and the exact Sales Plan and primary image
  document/version ids. Written once, never updated.
- **UnitMedia**, **UnitDocumentLink** — unchanged (E-05D §38-§44).
- **UnitPublicationApproval** — history only. Nothing writes it any more.

The enum keeps `DRAFT`, `READY_FOR_PUBLISHING` and `REVISION_REQUIRED` for
history; nothing writes them. Database rules held: composite FKs keep every
publication, image and link on its unit's project and company; a unit's current
version is one of its own; one primary image per unit; `(unitId, versionNumber)`
unique.

### Migration `20261109120000_units_publish_on_create`

1. `unit_publications.publishedByMemberId` becomes nullable.
2. Every unit not archived gets its next version (max + 1, publisher null) when
   it has no current version or its live facts differ from it by the
   fingerprint, with exactly the snapshot `buildSnapshot` writes; each becomes
   `PUBLISHED`, `hasUnpublishedChanges = false`, `revisionReason = NULL`
   (`publicationStatusChangedAt` set where the state changed). Archived units
   are untouched. A `PROJECT_UNIT_PUBLISHED` audit event (actor SYSTEM) per
   version.
3. Every `PENDING` publishing request is cancelled as archiving used to cancel
   one: the row (`CANCELLED`, `decidedAt`), its attention items (only those
   whose dedupe key carries the request's id), and an `APPROVAL_CANCELLED`
   audit event per unit.

Ids derive from the rows (`upub_…`, `audit_upub_…`), timestamps are UTC, and the
statements are safe to run again.

## Rules

| Rule | Where |
| --- | --- |
| Every creation publishes version 1 in its own transaction: one unit, a bulk range, a copied floor, and the Platform Admin's `unit.create` / `unit.bulk` in the 3D tool | `createUnit`, `bulkCreateUnits`, `copyUnits`; `createPlatformProjectStructure` |
| A **publish fact** is the unit's code, name, type, building, floor, position, orientation, any area, room counts, attributes, technical notes, Sales Plan version and primary image (and its version). Renaming a building, floor or type is not; neither is deactivating, attaching a drawing or adding a non-primary image | `publishFingerprint` |
| Every write that can change a publish fact calls `publishLiveUnits` in its own transaction: unit edit, unit move, floor moved to another building, Sales Plan set or new version recorded, primary image chosen, added (first image) or removed, restore, and the 3D tool's unit and floor edits. A unit whose fingerprint differs from its current version (or that has none) gets the next version; a save that changes nothing, or puts back what the current version already holds, writes nothing | `publishLiveUnits` |
| The version is written by whoever made the change (`publishedByMemberId`, `UNIT_PUBLISHED` activity, `PROJECT_UNIT_PUBLISHED` audit); a Platform Admin's change and a promoted file version are "Published automatically" (no member, no activity row; audit as the platform user or SYSTEM) | `PublishActor` |
| Publishing never changes the unit's state or its row `version`, so the version an edit returns is the one the next save sends | `publishLiveUnits` |
| The unit rows are locked in id order before the next version number is read: two changes at once get two versions | `publishLiveUnits` |
| A file version made current later — the scan worker, or a synchronous upload — publishes every unit whose Sales Plan or primary image it is, in the promotion's transaction | `promoteVersion` → `publishUnitsUsingDocument` |
| The checklist (§16, §45) is **information only**: key items (code, type, location, bedrooms/bathrooms/orientation for homes, active, no unavailable attachments) and recommended ones (primary area, Sales Plan, primary image). It never refuses anything | `evaluateReadiness`, `ReadinessPanel` |
| Archive keeps everything; a unit on sale is refused (`UNIT_ON_SALE`). An archived unit publishes nothing; restore brings it back **Published** and publishes its live facts as the next version if they moved (or as its first, if it never had one) | `archiveUnit`, `restoreUnit` |
| Archive and restore carry the version the person saw | `STRUCTURE_STALE` |
| One logical Sales Plan (§33-§36, §78); a document attached to a unit is the unit's own or its project's (§63, §100); media are JPEG, PNG or WebP, the first is primary (§42, §76) | `setUnitSalesPlan`, `attachUnitDocument`, `addUnitMedia`, `updateUnitMedia` |
| A unit is deleted only while nothing else points at it — no Sales Plan, media, links, files, old publishing request, sales or legal history; its own versions go with it | `deleteUnit`, `deleteOwnPublications` |

The snapshot keeps exactly: code, name, type (id, name, category), building (id,
name, code), floor (id, name, number, level), position, orientation, the eight
areas as two-decimal strings, rooms, bedrooms, bathrooms, attributes (nulls
dropped), technical notes, and the Sales Plan (document, version, its number,
file name) and primary image (document, version, category, caption) — each
only when available.

## Authorisation

Every read and write goes through the unit's project door first (E-05B): an id
from a project the person cannot open is a 404 that names nothing.

| Permission | What it allows |
| --- | --- |
| `project.structure.view` | The unit page |
| `project.unit.publication_history.view` | Published versions and their snapshots |
| `project.unit.documents.manage` | The Sales Plan and attached documents |
| `project.unit.media.manage` | Images |
| `project.unit.archive` | Archive and restore (Owner, CEO, Architecture's company manager and group head) |

Publishing is nobody's grant: whoever may change a unit publishes the change.
`project.unit.submit_for_publish`, `project.unit.publish`,
`project.unit.revision_request` and `project.unit.unpublish` were removed from
`config/`; `scripts/access-sync.ts` deletes a permission the registry no longer
declares, and its role grants with it (`role_permissions` cascade), on the
deploy that ships this.

## API

| Method and path | Does |
| --- | --- |
| `GET /api/project-units/:unitId/publishing` | Status, current version (with who published it, or null), readiness, capabilities |
| `POST …/archive`, `POST …/restore` | `{ expectedVersion }` |
| `GET …/publications`, `GET …/publications/:publicationId` | History, newest first; one version with its snapshot |
| Documents, Sales Plan, media, candidates, activity | As E-05D (§33-§44) |

`submit-for-publishing`, `publish`, `revision-required` and `unpublish` are
gone. The unit list's `publicationStatus` filter takes `PUBLISHED` or
`ARCHIVED`; an old link's retired status or `unpublishedChanges=true` is
ignored, not refused.

## Approvals Center

No unit publishing source: the provider was removed from the registry. The key
`projects` stays in `PROVIDER_KEYS` so an old link or a stored delegation still
parses; the registry answers it as an unknown source. `verify:workflows` errors
on any PENDING `unit_publication_approvals` row and warns on a unit left in a
retired state.

## Audit and activity

Audit: `PROJECT_UNIT_PUBLISHED` (version, publication, file versions; metadata
`automatic: true`), `PROJECT_UNIT_ARCHIVED`, `PROJECT_UNIT_PUBLICATION_STATUS_CHANGED`
(restore), the document and media events. Activity on the unit: created,
updated, code changed, moved, published (with its version), files and images,
archived, restored. Older rows of the retired actions stay readable.

## Screens

The unit header shows the publication badge (*Published v3* or *Archived*), the
commercial status, *Inactive* where it applies, and a menu with Archive or
Restore for those who may. **Publishing** shows the current version and who
published it (or *Published automatically*), the note that every saved change
is published at once, the checklist, and the history with each version's
snapshot. The unit list has a Publication column (badge only) and a
Published / Archived filter.

## Seed

Riverside Residences, Block A: **A-101** v1 (Sales Plan, floor plan image,
render, drawing); **A-102** v3 (balcony then saleable area corrected, each a
version); **A-103** v1, complete; **A-104** v1 with a Sales Plan and no image;
**B-101** v1 with a Sales Plan; **A-201** to **A-204** v1 with plan and image,
the stock the sales seed sells; every other unit v1, published automatically.
Company B's **OF-001** v1. No publishing requests.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/project-structure/publishing-rules.test.ts` | The checklist by kind of unit; display; the snapshot; the fingerprint; the machine (archive, restore only); validation; role defaults and the removed grants |
| `tests/api/project-structure/unit-publishing.test.ts` | v1 at creation (incomplete too), bulk and copy; edit → v2 with v1 intact, no-op save writes nothing, returned version still saves; move and floor move; Sales Plan, primary swap and removal with exact file versions; a scanner-promoted version published automatically; two changes at once; archive/restore; delete with own versions; access; list filter and old links; no Center source |
| `tests/api/project-3d/platform-structure.test.ts` | Platform-created units are Published v1 with no member; a platform move writes v2 |
| `tests/e2e/modules/unit-publishing.spec.ts` | A new unit is published; an edit appears as the next version while the old one keeps its values; archive and restore; Sales reads with no actions |

## Limits

- **Archiving a Sales Plan or primary image in Documents** (or a quarantine)
  changes what the unit would publish without a write to the unit; it goes out
  with the unit's next change. A version made current by the scanner is
  published at once (the Documents door).
- **No field-level diff** between versions: each snapshot is shown whole.
- **The checklist is fixed per kind of unit.**
- **A unit left in a retired state by old data** is not published by edits;
  archive and restore bring it back Published (`verify:workflows` warns).
