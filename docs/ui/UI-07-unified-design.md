> **Chat:** Nesto — mobile for the site team
> **File:** docs/ui/UI-07-unified-design.md
> **About:** Bringing every module and page, on desktop and phone, to the one design of My Day, the dashboard and the public site — the rules decided with the owner, what each wave changed, and what is left — for whoever builds or reviews a page next.
> **Last updated:** 2026-11-12 (the account panel redrawn, §4)

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

## 6. Not in scope

- The public site (`app/(public)`, `components/marketing`), which is the
  reference.
- The 3D project viewer (`components/3d`, `styles/project-viewer.css`), a
  technical viewport with its own panels over the model.
- The admin console's own pages wait for wave 5.
