# Project structure: buildings, floors and units (E-05B)

The physical project. Every project can hold buildings, every building floors,
every floor units — and every other module that ever needs a unit (Sales,
Finance, Documents, the 3D explorer) points at the same row by its id.

```
Company → Project → Building → Floor → Unit
                                         │
                   Sales · Finance · Documents · 3D — all by unitId
```

```
ONE UNIT · ONE UNIT ID · ONE UNIT PAGE · MANY REFERENCES · NO COPIES
```

There is no `SalesUnit`, `FinanceUnit` or `ThreeDUnit`, and there must never be.
A module that needs something about a unit adds its own table keyed by
`unitId`, or a column the unit's owner agrees to carry.

## Where things live

| Concern | Location |
| --- | --- |
| Types, labels, DTOs, limits (client-safe) | `lib/modules/project-structure/structure.types.ts` |
| Rules the browser previews and the server enforces: normalisation, floor names, keys and order, code generation, conflicts, copy suggestions, warnings | `lib/modules/project-structure/structure.rules.ts` |
| Validation | `lib/modules/project-structure/structure.schema.ts` |
| Access | `lib/modules/project-structure/structure.permissions.ts` |
| Reads: the tree, the unit list, the unit page, overview counts | `lib/modules/project-structure/structure.service.ts` |
| Buildings | `lib/modules/project-structure/structure.buildings.ts` |
| Floors, bulk floors, moving a floor | `lib/modules/project-structure/structure.floors.ts` |
| Units, bulk units, copying a floor, moving a unit | `lib/modules/project-structure/structure.units.ts` |
| Unit types: the company's own list | `lib/modules/project-structure/unit-type.service.ts`; defaults in `config/unit-types.ts` |
| API | `app/api/projects/[projectId]/{structure,buildings,buildings/reorder,units}`, `app/api/project-buildings/[buildingId]/**`, `app/api/project-floors/[floorId]/**`, `app/api/project-units/[unitId]/**`, `app/api/projects/unit-types/**` |
| UI | `app/(nesto)/projects/[projectId]/units` (tab **Units**), `app/(nesto)/projects/[projectId]/units/[unitId]` (the unit page), `app/(nesto)/projects/unit-types`, `components/project-structure/*`, `components/projects/unit-types-manager.tsx` |
| Demo data | `prisma/seed/structure.ts` |
| The unit page's sections, documents, media and publishing (E-05D) | `docs/unit-publishing.md` |
| A unit's price, commercial status, reservations and deals; the project's Sales tab (E-05E) | `docs/unit-sales.md` |

## Data

Migration `20260917120000_project_structure_e05b`, purely additive. Nothing held
units before, so there was nothing to map (§143, §144); the migration only
writes every existing company's ten default unit types.

- **ProjectUnitType** — per company: name, upper-case `code` (what an import
  maps to), `category` (Residential, Commercial, Parking, Storage, Land,
  Other), in use or retired, order. Names unique per company whatever their
  case; codes unique per company.
- **ProjectBuilding** — `name` (+ `nameKey`), optional `code` (+ `codeKey`),
  description, `sortOrder`, `isActive`, `version`. Name and code unique per
  project on their normalised keys (§9).
- **ProjectFloor** — `number` (nullable: a roof has none), `name`,
  `levelType` (Basement, Ground, Standard, Mezzanine, Technical, Roof, Other),
  `floorKey`, `sortOrder`, `elevation` (m, DECIMAL(10,2)), description,
  `isActive`, `version`. Unique per building on `floorKey` (§14).
- **ProjectUnit** — `unitCode` (+ `unitCodeKey`), `name`, `unitTypeId`,
  `position`, `orientation`, eight areas (`internalArea`, `grossArea`,
  `saleableArea`, `outdoorArea`, `balconyArea`, `terraceArea`, `gardenArea`,
  `commonAreaAllocation`; m², DECIMAL(12,2), never floats), `rooms`,
  `bedrooms`, `bathrooms`, `attributes` (JSON, see below), description,
  `sortOrder`, `isActive`, `version`. Code unique per project on its key (§68).

Every row carries `companyId`; floors and units carry the `projectId` they
derive from their parent. Those derived columns are **held to their parents by
composite foreign keys**, so the database — not only the service — refuses an
inconsistent row:

| Key | References | Guarantees |
| --- | --- | --- |
| building `(projectId, companyId)` | project `(id, companyId)` | a building is in its project's company |
| floor `(projectId, companyId)` | project `(id, companyId)` | a floor is in its project's company |
| floor `(buildingId, projectId)` | building `(id, projectId)` | a floor's project is its building's |
| unit `(projectId, companyId)` | project `(id, companyId)` | a unit is in its project's company |
| unit `(floorId, projectId)` | floor `(id, projectId)` | a unit's project is its floor's — so a unit cannot move to another project's floor |
| unit `(unitTypeId, companyId)` | unit type `(id, companyId)` | a unit's type is its own company's |

A unit does not store its building (§70): it is always `floor.building`, so a
floor moved to another building needs no unit rewritten.

**Deletion restricts everywhere.** A project, building, floor or unit type with
rows beneath it cannot be deleted from under them.

### Normalisation (§112, §113)

`structureKey`: Unicode NFKC, trimmed, inner whitespace collapsed, upper case.
`a-901` and `A-901` are one code; `Block  a` and `block A` are one name. The
value shown is always what was typed.

### A floor's identity (§14)

`floorKey` is `LEVELTYPE:number`, or `LEVELTYPE:NAMEKEY` for a level without a
number. So Floor 9 exists once per building and in any number of buildings; a
mezzanine at level 0 sits beside the ground floor; a building has one Roof.
Standard, basement and ground floors must have a number; a basement's is
negative.

### Type-specific details (§22, §71)

Searchable facts are columns. The few details that belong to one kind of unit
and nothing else live in `attributes`, validated by a closed schema:

| Attribute | Shown for | Kind |
| --- | --- | --- |
| `covered`, `evReady` | Parking | yes/no |
| `frontage` | Commercial | metres |
| `ceilingHeight` | Commercial, Storage | metres |

The service keeps only the attributes of the type's category, so changing a
unit's type drops details that no longer apply. No dynamic field engine.

## Rules

| Rule | Where |
| --- | --- |
| Every unit is on a floor of a building — a single-building project has one building (§7) | schema |
| Building name and code unique per project, whatever the case (§9) | `assertBuildingFree`, unique index |
| Floor unique per building on its key (§14) | `floorTaken`, unique index |
| A new floor takes its place in the default order — basements deepest first, ground, mezzanine, numbered floors, roof, technical — beside any order set by hand (§15) | `placeFloors` |
| Unit code unique per project whatever the case; the same code in another project is fine (§18) | `codeTaken`, unique index |
| A batch is checked whole before writing and written whole or not at all (§44, §45) | `bulkCreateFloors`, `bulkCreateUnits`, `copyUnits` |
| A batch is checked again inside its transaction, under a lock on its floor or building, and the unique index is the last word — two people bulk-adding the same codes: one succeeds, the other is told, nothing partial (§96) | `writeBatch`, `lockFloor`, `lockBuilding` |
| More than 50 floors at once must be confirmed; at most 200 floors or 500 units per batch (§39) | `FLOORS_CONFIRM_REQUIRED` |
| Every edit carries the version it read; a stale one is refused — *This unit was updated by another user. Refresh before saving.* (§95) | `STRUCTURE_STALE` |
| Renaming a building, changing a floor or a unit code, moving a unit or a floor — no id changes (§54, §55, §83) | update by id |
| A unit moves only to a floor of its own project (§118); the code does not change with it (§119) | `moveUnit`, composite key |
| A floor moves to another building only as its own action, its units with it (§53) | `moveFloor` |
| A building with floors, or a floor with units, is not deleted (§57) | `BUILDING_HAS_FLOORS`, `FLOOR_HAS_UNITS` |
| A unit may be deleted with the grant until something references it: a publication, files or a request (E-05D), or any sales history — a price, a reservation, a deal (E-05E). Then it is archived or deactivated instead (§56) | `deleteUnit`, `UNIT_REFERENCED` |
| A retired unit type is not offered for new units; a unit that has it keeps it (§116) | `requireUnitType` |
| Warnings, not refusals, for unusual data: bedrooms on parking, saleable smaller than internal (§74) | `unitWarnings` |
| Saleable area is entered, never derived (§24) | — |
| Counts are derived from rows, never stored (§88-§90) | `getProjectStructure` |

Copying a floor (§98) creates **new units with new ids**, taking the type,
position, orientation, areas, counts, attributes and description of the
originals and the codes the person confirmed. The suggested code replaces the
source floor's number at the head of the code's last run of digits: A-801 on
Floor 8 becomes A-901 on Floor 9, B2-0501 becomes B2-0601. A unit whose type
is retired is not copied.

## Authorisation (§58, §59, §78-§82)

Every read and write: authenticated → Projects module on and reachable →
`project.view` + `project.structure.view` → the project inside the person's
project scope (`buildProjectScopeWhere`) → the action's permission. Buildings,
floors and units are only ever found through that door, with `companyId`
first in every `where`. Nothing is authorised by "same company" alone.

| Permission | What it allows |
| --- | --- |
| `project.structure.view` | The Units tab, the tree, the unit list and the unit page |
| `project.structure.manage` | Ordering buildings, floors and units; moving a floor to another building |
| `project.building.create` / `.update` / `.delete` | Buildings |
| `project.floor.create` / `.update` / `.delete` | Floors, bulk floors included |
| `project.unit.create` / `.update` / `.delete` | Units, bulk units and copies included; a code change is an update |
| `project.unit.move` | A unit to another floor |
| `project.unit_type.manage` | The company's unit types — company configuration, on no ladder |

| Role | View | Buildings, floors, units | Unit types |
| --- | --- | --- | --- |
| Owner | yes | yes | yes |
| Admin | yes | yes (override) | yes (override) |
| Project Manager | own projects | own projects (MANAGE rung) | no |
| Architecture Manager | every project of the company | yes (override) | no |
| Architect | assigned projects | assigned projects (override) | no |
| Engineer | assigned projects | no | no |
| CEO, Finance, Legal, Sales, Procurement, HR, … | yes, in their scope | no | no |
| Viewer | assigned projects | no | no |

NESTO has no Parent Group Owner role; its E-05B row is policy for when it exists.
The Architecture Manager role arrived with E-05D and holds E-05B's row (§59). Grants are data (`config/role-defaults.ts`),
never role names in code.

**Not found, not forbidden.** A building, floor or unit id from a project the
person cannot open is a 404 that names nothing. The unit page checks the unit
belongs to the project in its URL: `/projects/A/units/<a unit of B>` is not
found, even for somebody who can open B. A move or copy aimed at another
project's floor or building is a 422 on that field (`CROSS_PROJECT_REFERENCE`).

**Archived and finished projects** keep their structure readable and editable
(§115): E-05B freezes nothing; a later policy may.

## API

| Method and path | Does |
| --- | --- |
| `GET /api/projects/:projectId/structure` | Buildings → floors with unit counts, totals, the company's unit types, capabilities. No units (§65) |
| `GET /api/projects/:projectId/buildings` | The buildings of the tree |
| `POST /api/projects/:projectId/buildings` | Add a building |
| `POST /api/projects/:projectId/buildings/reorder` | `{ ids }` naming every building once |
| `PATCH /api/project-buildings/:buildingId` | Name, code, description, active, `expectedVersion` |
| `DELETE /api/project-buildings/:buildingId` | Only without floors |
| `GET /api/project-buildings/:buildingId/floors` | Floors with unit counts |
| `POST /api/project-buildings/:buildingId/floors` | Add a floor |
| `POST /api/project-buildings/:buildingId/floors/bulk` | `{ floors: [{number, name, levelType}], confirmLarge?, dryRun? }` |
| `POST /api/project-buildings/:buildingId/floors/reorder` | `{ ids }` |
| `PATCH /api/project-floors/:floorId` | Number, name, level, elevation, description, active, `expectedVersion` |
| `DELETE /api/project-floors/:floorId` | Only without units |
| `POST /api/project-floors/:floorId/move` | `{ buildingId, expectedVersion }` |
| `POST /api/project-floors/:floorId/units` | Add a unit on this floor |
| `POST /api/project-floors/:floorId/units/bulk` | `{ units: [{unitCode, name?}], defaults, dryRun? }` |
| `POST /api/project-floors/:floorId/units/copy` | `{ sourceFloorId, units: [{sourceUnitId, unitCode, name?}], dryRun? }` |
| `POST /api/project-floors/:floorId/units/reorder` | `{ ids }` |
| `GET /api/projects/:projectId/units` | `q`, `buildingId`, `floorId`, `unitTypeId`, `orientation`, `position`, `bedrooms`, `bathrooms`, `internalAreaMin/Max`, `saleableAreaMin/Max`, `sort`, `page`, `limit` (50, ≤ 100); answers `{ items, page, pageSize, total }` |
| `GET` / `PATCH` / `DELETE /api/project-units/:unitId` | The unit; code and technical data with `expectedVersion`; delete |
| `POST /api/project-units/:unitId/move` | `{ floorId, expectedVersion }` |
| `GET` / `POST /api/projects/unit-types`, `PATCH` / `DELETE /api/projects/unit-types/:unitTypeId`, `POST /api/projects/unit-types/reorder` | The company's unit types |

Paths follow this codebase's `project-phases` / `project-milestones` naming
rather than the PRD's suggested `/api/buildings`, so no top-level segment
collides with another module. A batch's `dryRun` answers
`{ count, conflicts: [{ index, value, reason: EXISTS | REPEATED }] }` and writes
nothing; the real call answers 409 with the same `conflicts` if anything clashed
in between. Unit creates and edits also answer `warnings`.

Sorts: `structure` (default: building order, floor order, unit order, code),
`code` / `-code`, `floor`, `type`, `saleableArea` / `-saleableArea`,
`internalArea` / `-internalArea` — empty areas last. Search matches code, name
and type name, case-insensitively.

## Audit (§75-§77)

`PROJECT_BUILDING_CREATED` / `_UPDATED` / `_DELETED`,
`PROJECT_FLOOR_CREATED` / `_UPDATED` / `_DELETED` / `_MOVED`,
`PROJECT_FLOORS_BULK_CREATED`, `PROJECT_UNIT_CREATED` / `_UPDATED` / `_MOVED` /
`_DELETED`, `PROJECT_UNITS_BULK_CREATED`, `UNIT_CODE_CHANGED` (beside the
update, before and after), `PROJECT_STRUCTURE_REORDERED`, and
`PROJECT_UNIT_TYPE_CREATED` / `_UPDATED` / `_DELETED` / `PROJECT_UNIT_TYPES_REORDERED`.
Each carries `projectId` and the entity; moves carry the old and new floor or
building. A batch is **one** event whose metadata holds `batchId`, the floor or
building, the codes (or names) and the created ids — not a hundred copies of
the same payload. Everything is written in the transaction of the change it
describes. Activity is recorded against the project too, so structure work
counts as project activity on the Projects page. No notifications (§128).

## Screens

**Projects → a project → Units.** Desktop: the tree on the left — *All units*,
then each building with its floor and unit counts, expandable to its floors
with their unit counts (a find box appears past eight buildings) — and the
choice on the right: its title (*Floor 9 — Block A*), its counts, its actions,
then search, filters (type, orientation, position, bedrooms, bathrooms, area
ranges), sort, the unit table and 50 per page. Inside one floor the Building and
Floor columns are left out. Phone and tablet: Building and Floor dropdowns in
place of the tree, units as cards. The URL holds the choice (`?floor=` or
`?building=`) and the filters.

- **Empty project:** *Set up project structure — Start by adding the first
  building.* with **Add building** for somebody who may.
- **Empty building:** *No floors yet. Add floors to Block A.* with **Add floor**
  and **Create floors**.
- **Empty floor:** *No units on this floor.* with **Add unit**, **Bulk add
  units** and **Copy a floor**.
- **Create floors:** building and range → names and review (each name and level
  editable, clashes marked, a confirmation past 50) → create.
- **Bulk add units:** codes (prefix, start, end, digits, suffix, with the first
  and last code shown) → shared details (type, position, orientation, areas,
  counts) → preview (every code, clashes marked) → create.
- **Copy a floor:** choose the source floor, check or edit each suggested code,
  create.
- Building and floor menus: edit, add floors, move up and down, move a floor to
  another building (with what moves spelled out), delete. Unit menu: open,
  edit, move to another floor, move up and down (inside a floor, in structure
  order), delete.
- Loading the units fails → *Could not load units.* with **Retry**; the page
  failing → *Could not load project structure.* with **Retry**.

**The unit page** `/projects/:projectId/units/:unitId` — breadcrumb Projects /
company / project / building / floor / code, each level a link (the building and
floor open the Units tab there); header *A-901*, the type, *Block A · Floor 9*;
technical data and areas; **Edit**, **Move** and delete for those who may. It is
the one page every future module opens for this unit. E-05D gave it its
Overview, Documents, Media, Publishing and Activity sections — see
`docs/unit-publishing.md`.

**Projects → Unit types** (Owner and Admin): add with a code and category,
rename, recode, recategorise, order, retire, use again, delete an unused one.

The project overview has a **Units** card with building, floor and unit counts.

## Seed

Riverside Residences (*96 apartments across three blocks*): Blocks A, B and C,
each with Basement 1 (six parking spaces, two covered and EV-ready, and two
storage rooms), a Ground Floor with two shops, and Floors 1–8 with four
apartments each (A-101…A-804) — so Floor 1 exists in all three blocks. Block A
also has a Roof with no units. 126 units. Central Office Tower has no structure
(the empty state). Company B's Munich Workspace Fitout has one building, a
ground floor of three offices and an empty first floor. Re-running the seed
replaces all three.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/project-structure/rules.test.ts` | Normalisation, floor names, keys and default order, ranges, code patterns, conflicts, copy suggestions, warnings, schema parsing |
| `tests/api/project-structure/structure.test.ts` | Buildings, floors, units, bulk and copy (all or nothing, one audit event), moves keeping ids, versions, delete rules, the unit list's filters, sorts and pages, the unit page's project check, every role's grants, Architect scope, cross-company and cross-project ids, two batches racing |
| `tests/api/project-structure/unit-types.test.ts` | Who keeps the list, uniqueness, retirement, order, deletion, company isolation |
| `tests/api/company/company-bootstrap.test.ts` | A new company starts with the default unit types; a rerun does not restore a removed one |
| `tests/security/*` | The new routes are swept by discovery (Company A ↔ B, project isolation); `buildingId`, `floorId`, `unitId`, `unitTypeId` resolve to real rows. The harness now knows the shape of `ids`, `floors`, `units`, `defaults` and a floor `number` (`tests/security/harness/routes.ts`), so batch, copy and reorder requests get past validation and reach the lookup they attack — before, seven of these routes stopped at a 422 and proved nothing |
| `tests/e2e/modules/project-structure.spec.ts` | A Project Manager builds a building, floors by range, units by pattern and a copied floor, opens a unit, moves it, changes its code; Sales reads without actions; a Company B unit is not found |
| `tests/e2e/responsive/project-structure-mobile.spec.ts` | Building and floor dropdowns and unit cards on a phone |
| `tests/perf/project-structure.perf.test.ts` | Opt-in (`NESTO_PERF=1`): 10 buildings × 25 floors × 40 units = 10,000. P95 locally: tree 10 ms, one floor 7 ms, filtered and sorted 30 ms, first page 157 ms, page 150 182 ms, search 183 ms (target 500). The tree takes as many queries at 10,000 units as at 126; a page as many at 100 rows as at 5 |

## Limits

- **No commercial status yet.** §27's For Sale / Reserved / Sold belongs to the
  Sales PRD, which will add it to — or beside — this unit, keyed by `unitId`,
  with a state machine. The unit table has no Status column until then.
- **Unit deletion is guarded by references since E-05D**: a unit with a published
  version, a Sales Plan, media, attached documents, files or a publishing request
  is refused (`UNIT_REFERENCED`) and archived or deactivated instead. Sales,
  Finance and 3D references must join that check when they arrive (§56).
- **Page-numbered, not cursor, pagination.** The unit list is 50 per page with a
  total. At 10,000 units the whole-project list in structure order is the
  slowest read (~160-180 ms: it sorts through the floor and building join and
  counts); one floor stays under 10 ms. Past that scale, a keyset cursor over
  denormalised sort keys is the next step.
- **Import is not built** (§97). The bulk services take a list of drafts rather
  than a range, so an import can call them directly.
- **No copy building, typical floor or template floor** (§99, §100).
- **A company's own retired unit type** is refused as an ordinary validation
  error; another company's type is refused as a cross-company reference and
  logged as one.
- **Unit types are per company, not per Parent Group**, and a type's
  `fieldSchema` is its category: the details offered per category are fixed in
  `structure.types.ts`.
- **Floor move between buildings keeps the floor's key**, so it is refused when
  the target building already has that floor.
- **Module pages are English**; only the *Unit types* section label is
  translated, as for every other section.
