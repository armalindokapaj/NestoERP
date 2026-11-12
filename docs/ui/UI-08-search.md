> **Chat:** Nesto — mobile for the site team
> **File:** docs/ui/UI-08-search.md
> **About:** The redesigned global search — one palette for records, pages and actions, on desktop and phone, with units now findable — what it does, how it looks, where it lives and what it leaves out, for whoever changes search next.
> **Last updated:** 2026-11-13

# UI-08 — Search: one palette for records, pages and actions

The search the top bar opens (the field at the top right, the magnifier on a
phone, Ctrl+K or ⌘K anywhere) was a narrow "liquid glass" slab, a third of the
page wide, whose rim bent the page behind it; a phone got a plain white
screen. Results were one plain list by module, with nothing to narrow it, no
way to reach a page or start an action, and no unit could be found at all.

Decided with the owner on 2026-11-12: a centred palette; records, pages and
actions in one box with filters by kind; a full-screen lined version on a
phone; units in search.

## 1. What it finds

| Kind | From | Opens |
| --- | --- | --- |
| **Records** | `/api/search`: one provider per module, each applying the module's own company, permission and record scope (PRD #26). | The record. In the Group workspace a record in a company opens that company first. |
| **Units** (new) | The units provider (`lib/core/search/search.providers.ts`): by the code as people read it ("T-501", the building's code and the unit's), the unit's own code ("501"), or its type. Through the projects' door (`readableUnitWhere`), archived units left out. | For somebody who may see the units' sales, the unit's sales page (`/sales/units/<id>`) and its sale status; for anybody else the unit in its project, with no status. |
| **Pages** | The person's own navigation, as the server resolved it for them (the logo's panel and the Ribbon), each once, with the place it sits in (Home, Work, Sales…). | The page. |
| **Actions** | The create actions Quick Create offers on this page (`/api/quick-create/actions`), read when the palette opens. | Quick Create runs it as its + would — the company or project step first when the action needs one (`QUICK_CREATE_PICK_EVENT`). |

The filters under the field narrow it to one kind: **All · Projects · Units ·
Tasks · People · Clients · Documents · Pages**. A filter asks the server only
for its kinds (`/api/search?type=project_unit`, more of them since nothing
else shares the list); Pages is the palette's own list and asks nothing.

With nothing typed: Favorites and Recent Work under All, as before; every page
and action under Pages; a line saying what to type under any other filter.

With something typed: the records by kind (a unit is a **Unit**, not a
Project; a kind without a filter keeps its module's name), each in the
server's ranking, with up to four pages and three actions that match. When a
page or an action starts with what was typed ("sal" → Sales), they come first;
otherwise after the records. Pages and actions match from the first letter;
records from the second, as before. Accents and case do not count, so "shitj"
finds "Shitjet".

## 2. How it looks

**From 640px** — a palette 720px wide (less the gutters on a narrow window),
in the upper third of the window (`max(72px, 12vh)` from the top), over the
page dimmed behind it. A solid surface in a 1px strong line, square, with the
dialog's shadow because it floats; no glass.

- **The field**, 56px, the whole width, in 17px type, the magnifier at its
  left (a spinner while searching) and an **Esc** key at its right that closes
  it.
- **The filters**, mono capitals in square cells; the one chosen is ink.
- **The results**, grouped under mono captions with their count. Each row is a
  lined 32px square with its icon, the name with the typed text underlined in
  gold, what it belongs to under it, and at the right its company (Group
  workspace), status badge and star. The row the arrows are on is shaded and
  carries a 2px gold rule at its left and a ↵ key.
- **The keys** at the foot: ↑ ↓ Move · ↵ Open · Tab Filter · Esc Close.

**Below 640px** — the whole screen. The field in a lined box with **Cancel**
beside it; the filters in one row that scrolls sideways; the results as lined
rows the width of the screen, as Sales units lists its units. A star shows only
on a starred row there, so the name keeps its room.

**Keys** — ↑ ↓ move, Enter opens, Tab and Shift+Tab step through the filters,
Esc closes; Ctrl+K or ⌘K opens and closes it from anywhere.

## 3. Where it lives

| Piece | File |
| --- | --- |
| Trigger, shortcut, palette frame, field, filters, reads | `components/layout/global-search.tsx` |
| Results, Search Home, rows (loaded on open) | `components/layout/panels/search-panel-body.tsx` |
| Filters, matching, marking (client-safe, unit-tested) | `lib/core/search/palette.ts`, `tests/unit/navigation/search-palette.test.ts` |
| Filter by kind on the server | `lib/core/search/search.service.ts` (`entityTypes`), `app/api/search/route.ts` (`type`) |
| Units provider | `lib/core/search/search.providers.ts` (`unitProvider`), `tests/api/search/search-providers.test.ts` |
| Pages handed to search | `components/layout/topbar.tsx` |
| An action handed to Quick Create | `QUICK_CREATE_PICK_EVENT` in `lib/modules/quick-create/menu-cache.ts`; Quick Create listens and runs it as the dial does |

The palette keeps the frame's testids (`search-trigger`, `search-input`,
`palette-favorites`, `palette-recent`, `search-result-star`,
`search-view-all-recent`); new ones are `search-palette`,
`search-scope-<key>`, `palette-pages` (Go to), `palette-actions` (Create) and
`search-keys`.

## 4. Not in scope

- The Admin Console has its own palette in this design
  (`components/platform/admin-search.tsx`, docs/ui/UI-09-admin-console.md).
  The Group console's search (`components/platform/platform-search.tsx`)
  keeps its glass panel (`components/ui/glass-panel.tsx`).
- Recent searches (what was typed before) and a preview of the record beside
  the list were left out on purpose; they can follow.
