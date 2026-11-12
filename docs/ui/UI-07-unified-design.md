> **Chat:** Nesto — mobile for the site team
> **File:** docs/ui/UI-07-unified-design.md
> **About:** Bringing every module and page, on desktop and phone, to the one design of My Day, the dashboard and the public site — the rules decided with the owner, what each wave changed, and what is left — for whoever builds or reviews a page next.
> **Last updated:** 2026-11-12 (the project's Overview, §6)

# UI-07 — One design across the app

My Day, the dashboard, the shell and the public site were drawn in the new
design ("lines, glass and the ruler", UI-05 §9). The modules were not. This
page is how every page is brought to it, in waves, each merged to main.

## 1. The rules (decided 2026-11-12)

| Rule | What it means on a page |
| --- | --- |
| **Lines, square, type** | Square corners everywhere; panels and lists are cells sharing 1px lines, not floating cards with shadows and gaps; headings in the display face end on the gold square; glass only on what floats or what the page passes under. No numbered section bars or ruler inside the app (those stay the public site's). |
| **Sentence-case buttons, mono labels** | Buttons stay 14px sentence case. Mono capitals are for a section's head, a table's column labels, a figure's caption and badges — never for a record's own name or a sentence. |
| **What stays round** | People's avatars, status dots (and a timeline's dots, a radio's dot) and the Create dial. Everything else is square: cards, inputs, selects, checkboxes, switches, badges, chips, tabs, menus, popovers, dialogs, sheets, tooltips, progress bars, skeletons, icon boxes. |
| **Waves** | Shared pieces first, then the modules in waves, desktop and phone together, each merged to main with screenshots. |

## 2. How a page is drawn now

- **Corners.** Every radius token is 0 (`styles/tokens.css`), so `rounded`,
  `rounded-sm` … `rounded-3xl` and the control, card, sheet and overlay
  radii are square wherever they are used. `rounded-full` is the one round
  class, and only on avatars, dots and the dial. Don't add a radius.
- **Panels.** `.nesto-card` is a surface inside a 1px line with no shadow
  (`--nesto-shadow-card: none`). Panels laid out together share their lines
  on their own: any grid, row or stack (`.grid`, `.flex`, `space-y-*`) whose
  children are all `.nesto-card` loses its gap and pulls each card 1px over
  its neighbour (the last rule in `styles/globals.css`). Put anything else in
  the container — a heading, a button — and it keeps its gaps, so a section's
  head goes outside the grid of its panels. For rows of records, a lined list
  (`components/ui/lined.tsx`).
- **A section's head** is `nesto-section-head` (`styles/globals.css`): mono
  capitals, 12px, wide spacing — as My Day's `LineCaption`. A record's name
  in a card keeps the ordinary face.
- **Page titles** are in the display face everywhere: a module's or a
  page's ends on the gold square over the ink rule
  (`components/ui/page-header.tsx`); a form's or a record's title (New
  purchase order, Edit hazard) is the display face alone.
- **Capital labels** — eyebrows, captions, small headings in capitals — are
  always the mono face, medium weight; never bold capitals in the body face.
- **Tables** were already in the design: mono column labels over an ink line.
- **Overlays** — menus, popovers, the select's list, dialogs, sheets — are
  square and keep their shadow, because they float.

The component catalog (`/dev/ui`, development only) shows every shared piece
in this design; its "Page and panels" entry is a module page's parts.

## 3. Waves

| Wave | Scope | State |
| --- | --- | --- |
| 1 | The shared pieces: tokens, cards, section heads, inputs, selects, checkboxes, switches, tabs, badges and chips, empty and error states, skeletons, dialogs, sheets, menus, popovers, tooltips, progress bars — which already changes every page | Done 2026-11-12 |
| 2 | Every module at once, by rule rather than page by page: panels share their lines, every capital label is mono, every page title is in the display face, the project cards and the project page lose their lift, blob and shadows | Done 2026-11-12 |
| 3 | Page by page: what a rule cannot see — a page whose layout mixes panels with headings or buttons in one grid, a hero, a picture frame — from the owner's list of pages that still look off, checked at 390px and 1280px in Day and Night | Open |

Wave 2 replaced the module-by-module waves planned at first: the same few
rules reached every module, so going module by module would only have
repeated them. What is left needs the pages with their real data in front of
someone, which this environment cannot render (no database).

### Wave 1, in numbers

- 140 round classes squared in 95 files; 24 kept (avatars, dots, the dial).
- 514 panel headings moved to `nesto-section-head`.
- The fixed corner values of the inputs, selects, checkboxes, menus,
  popovers, dialogs, drawers and sheets removed; the phone's sheets and the
  touch layouts' popups square too; the search panel's glass square.

### Wave 2, in numbers

- One rule lines every grid, row and stack made only of panels, across all
  modules.
- 66 capital labels moved to the mono face; 124 page titles to the display
  face.
- The project cards are lined plates (no lift, no shadow); the project
  page's hero loses its decorative circle and shadow, its title in the
  display face.

## 4. The account panel

The panel the avatar at the top right opens (`components/shell/account-panel.tsx`),
redrawn in the drawing set, 352px wide:

- **You, at the top:** the same gold disc as the button that opened it, your
  name in the display face, your role in mono capitals beside the workspace.
  The whole block opens your profile; a chevron says so.
- **Three lined sections under mono captions** — Account (settings, company
  or group settings, platform admin), Appearance, Help — then Sign out alone
  at the foot, in red.
- **Rows that leave the panel carry a chevron;** controls that change
  something in place are square segmented choices that show their state:
  Theme `LIGHT | DARK` and Language `EN | SQ`. The language was a flag that
  cycled on a click; it is now both languages, the current one filled, so
  nobody has to guess what a click will do. Both are radio groups: arrow
  keys move the choice.

## 5. Filters: a few, then More filters

A list shows the few filters people reach for first, and keeps the rest
behind **More filters** (`ListToolbar`'s `more`, `components/data/filter-sheet.tsx`):
on a phone the Filters sheet ends on a More filters line that opens the
same sheet to the whole screen, one draft and one Apply for both; from md a
More filters button beside the inline filters opens a panel at the right.
More filters are ranges (from–to, two query keys) or selects; their count
joins the Filters badge and Clear all clears them. Sales units is the first
list to use it (docs/unit-sales.md); others take it as each is reviewed.

## 6. The project's Overview

`/projects/<id>` (`app/(nesto)/projects/[projectId]/page.tsx`, drawn by
`components/projects/overview/project-overview.tsx`), reworked 2026-11-12.

**What it held, and why it was messy.** A dark hero 430–500px tall with the
picture, a status line, the name, the place and type, a progress text and a
white progress bar; beside it big dark tiles for 3D, renders and animations;
then a Summary card repeating the place, the type and the progress next to the
manager, dates, area and the description; then three cards (my work, upcoming,
activity) with gaps between them; then the media library. A phone added its
own block above all that — a 3D button, four rounded quick-action tiles, a
"requires attention" card and three metric tiles — and still drew the summary,
cards and media below. The project's name was shown three times on a phone (top
bar, compact header, heading), the progress four times on a desktop.

**What it is now.** One page, in the drawing set, the same pieces at every
width — and from lg nothing left blank beside anything else:

| Piece | From lg | Below lg |
| --- | --- | --- |
| Title block | Mono line: code · company · status, the ⋯ after the status; the name in the display face on its gold square; the description as a two-line italic standfirst; place · type · area · due in mono. The figures stand on the block's foot — progress (with a thin gold rule along its cell), open tasks, overdue (red when any), units, each opening its list — so the left half is filled to the ink rule. At the right the picture fills its column down to the same rule, with View in 3D (ink, opens beside), Renders and Animations in one row of cells under it. | The top bar names the project; the compact header is code · company in mono, status, ⋯. The heading stays for a screen reader. Then the figures and, flush under them, Task · Document · Site diary · Meeting. |
| The sections | Two columns that balance themselves (CSS columns): each section keeps whole and the next fills the shorter column, so neither runs on alone. 01 / My work (tasks assigned, approvals, meetings, documents — a kind with nothing is left out); 02 / Upcoming (a mono day, the title, its kind); 03 / Recent activity (View all in the caption); 04 / Details (manager, completion, place, type, area, last edited, the deal it came from — mono label, value on the right); 05 / Visual library (four renders in cells sharing lines, the animations, View all media). | One column in the same order, the picture and its 3D, renders and animations rows after My work, the description under Details. |

The project's overdue tasks are one figure, not also a line under My work.
Every piece still streams in its own place, and a section that fails says so.

## 7. Not in scope

- The public site (`app/(public)`, `components/marketing`), which is the
  reference.
- The 3D project viewer (`components/3d`, `styles/project-viewer.css`), a
  technical viewport with its own panels over the model.
- The admin console's own pages wait for wave 5.
