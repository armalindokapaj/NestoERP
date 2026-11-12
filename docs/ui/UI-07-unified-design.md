> **Chat:** Nesto — mobile for the site team
> **File:** docs/ui/UI-07-unified-design.md
> **About:** Bringing every module and page, on desktop and phone, to the one design of My Day, the dashboard and the public site — the rules decided with the owner, what each wave changed, and what is left — for whoever builds or reviews a page next.
> **Last updated:** 2026-11-12 (wave 1: the shared building blocks)

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
  (`--nesto-shadow-card: none`). Where two panels sit side by side or one
  above the other, they share a line rather than standing apart: no gap, the
  second pulled over the first's border (`-mb-px`, `-mr-px`), or a lined
  list (`components/ui/lined.tsx`).
- **A section's head** is `nesto-section-head` (`styles/globals.css`): mono
  capitals, 12px, wide spacing — as My Day's `LineCaption`. A record's name
  in a card keeps the ordinary face.
- **Page titles** stay as they are: the display face, the gold square, the
  ink rule (`components/ui/page-header.tsx`).
- **Tables** were already in the design: mono column labels over an ink line.
- **Overlays** — menus, popovers, the select's list, dialogs, sheets — are
  square and keep their shadow, because they float.

The component catalog (`/dev/ui`, development only) shows every shared piece
in this design; its "Page and panels" entry is a module page's parts.

## 3. Waves

| Wave | Scope | State |
| --- | --- | --- |
| 1 | The shared pieces: tokens, cards, section heads, inputs, selects, checkboxes, switches, tabs, badges and chips, empty and error states, skeletons, dialogs, sheets, menus, popovers, tooltips, progress bars — which already changes every page | Done 2026-11-12 |
| 2 | Projects and everything inside a project | Next |
| 3 | Sales, clients, contracts, finance | |
| 4 | Procurement, inventory, HR, workforce, timesheets | |
| 5 | Settings, organization, people, the admin console, help and the rest; a last sweep | |

Each module wave turns the module's grids of separate cards into shared-line
grids, removes the page-specific leftovers (hero blobs, lifted shadows,
rounded photo frames) and checks the page at 390px and 1280px in Day and
Night.

### Wave 1, in numbers

- 140 round classes squared in 95 files; 24 kept (avatars, dots, the dial).
- 514 panel headings moved to `nesto-section-head`.
- The fixed corner values of the inputs, selects, checkboxes, menus,
  popovers, dialogs, drawers and sheets removed; the phone's sheets and the
  touch layouts' popups square too; the search panel's glass square.

## 4. Not in scope

- The public site (`app/(public)`, `components/marketing`), which is the
  reference.
- The 3D project viewer (`components/3d`, `styles/project-viewer.css`), a
  technical viewport with its own panels over the model.
- The admin console's own pages wait for wave 5.
