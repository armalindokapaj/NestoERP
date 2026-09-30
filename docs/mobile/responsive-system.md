# NESTO responsive system (MOB-01)

One NESTO, one design system, one component set, several viewport
presentations. There are no `/mobile/*` routes, no mobile permissions, no
mobile APIs and no user-agent branching. Every rule below is what MOB-02 and
later PRDs build on. Start with `MOB-01-audit.md` for what already existed.

## Breakpoints

Tailwind v4, declared once in `styles/globals.css` (`@theme`), mirrored in
`BREAKPOINTS` (`components/ui/use-breakpoint.ts`) and held together by
`tests/unit/responsive/mob01-foundation.test.ts`.

| Name | From | Reads as |
|---|---|---|
| (base) | 0 | phone, compact below 480 |
| `xs` | 480 | phone |
| `sm` | 640 | large phone |
| `md` | 768 | tablet portrait; phone chrome (`md:hidden`) ends here |
| `lg` | 1024 | desktop; the navigation drawer becomes the icon rail |
| `xl` | 1200 | full sidebar |
| `2xl` | 1440 | large desktop |

Never write a raw pixel breakpoint in a module. The `touch:` variant
(`max-width: 1023.98px` or `pointer: coarse`) is for hit areas: it says
"a finger is likely", which width alone does not.

Prefer CSS. Where a component's layout depends on its own width rather than the
screen's, use container queries (`@container`, `@sm:` and friends) — a unit card
in a narrow dashboard column is compact on a desktop too.

## Tokens (`styles/tokens.css`)

Semantic, extend the existing token file, respond to the viewport in CSS.

| Token | Phone | Tablet (md) | Wide (xl) |
|---|---|---|---|
| `--nesto-space-page-x` | 16px | 24px | 32px |
| `--nesto-space-page-y` (top) | 20px | | |
| `--nesto-space-page-y-end` | 24px | 32px | |
| `--nesto-space-card` | 16px | 20px (sm) | |
| `--nesto-space-section`, `--nesto-space-control` | 24px, 8px | | |
| `--nesto-height-control` | 44px under `touch:`, 40px with a mouse | | |
| `--nesto-height-control-compact` | 44px under `touch:`, 32px with a mouse | | |
| `--nesto-touch-target-min` | 44px | | |
| `--nesto-radius-control` / `-card` / `-sheet` | 8 / 12 / 16 | | |
| `--nesto-content-max-width` | 1600px | | |
| `--nesto-safe-top/right/bottom/left` | `env(safe-area-inset-*, 0px)` | | |
| `--nesto-sticky-top-offset` | where a page's sticky regions start (the shell's sticky stack) | | |

## Z-index

One ladder (`tokens.css`, mirrored in `config/theme.ts`, drift-tested).

| Layer | Value | Token |
|---|---|---|
| content | 0 | `--nesto-z-content` |
| sticky (in-page) | 10 | `--nesto-z-sticky` |
| header (shell) | 30 (breadcrumb 29, tabs 28) | `--nesto-z-topbar` |
| drawer / backdrop | 50 | `--nesto-z-drawer` |
| sheet | 55 | `--nesto-z-sheet` |
| modal (dialog) | 60 | `--nesto-z-dialog` |
| popover / dropdown | 65 | `--nesto-z-floating` |
| tooltip | 66 | `--nesto-z-tooltip` |
| toast | 70 | `--nesto-z-toast` |
| critical (unsaved prompt) | 80, skip link 90 | `--nesto-z-unsaved-prompt`, `--nesto-z-critical` |

Do not invent a new number. Table-internal `z-[1]` for a sticky first column is
the one accepted exception.

## Page container

`components/ui/page-container.tsx`: `<PageContainer variant="default|wide|full|compact" gutter="page|none" as="main">`.
Gutters are `max(--nesto-space-page-x, safe inset)`, so a notch in landscape
never clips content. The shell's `<main>` is a PageContainer. Do not add your
own page padding; nest with `gutter="none"`.

## Layout primitives

- `Stack` — flex with token gaps. `stackBelow="sm"` turns a row into a column on a phone; `reverseWhenStacked` puts the DOM-last (primary) action on top; `fillWhenStacked` makes the children full width.
- `ResponsiveGrid` — `cols={{ base: 1, md: 2, xl: 3 }}`, or `minItemWidth="16rem"` to fit by container width (safe at 320: `min(100%, …)`). `FormGrid` is one column, two from md.
- `Card` — `interactive`, `selected`, `disabled`, `compact`, `loading`, `status` rail.

## Sticky regions

`StickyStack` with `StickyHeader`, `StickySubHeader`, `StickyTabs`
(`components/ui/sticky.tsx`). Each measures itself (one `ResizeObserver`
each) and starts below the ones above it, under the shell's sticky stack. No
module writes `top: 64px`. `StickyActions` is the bottom bar: sticky on a
phone, in the flow from md, clear of the home indicator, marked
`data-sticky-action-bar` so toasts and focus scrolling keep clear of it.

## Overlays

| Need | Use |
|---|---|
| Short confirm / create | `Dialog` (centred). Below 640: `presentation="fullscreen-phone"` for a task, `"sheet-phone"` for a short choice. `DialogFooter stackOnPhone` for full-width stacked actions |
| Short mobile interaction: filter, sort, selector, contextual actions | `BottomSheet` (title required, drag handle, footer slot, safe-area padding) |
| Off-canvas panel, navigation | `Drawer` (left / right / bottom) |
| Anchored | `Popover`, `DropdownMenu`, `Select` — Radix keeps them inside the viewport; heights are capped to the room available |

All are guarded (unsaved input is protected), trap and restore focus, close on
Escape, and use `dvh` so an open keyboard does not push them off screen.
The viewport is `interactive-widget=resizes-content`, so on Android Chrome the
keyboard shrinks the layout and bottom bars ride above it.

## JavaScript viewport

`useResponsive()` returns `{ isPhone, isTablet, isDesktop, orientation, hasFinePointer }`,
every field `undefined` until hydration (so server and client agree). Phone is
below `md`, tablet is `md`–`lg`, desktop is `lg` and up. Built on shared
media-query stores. Do not read `window.innerWidth` or the user agent, and do
not render a different tree on the server by width. Older per-module
`matchMedia` copies are listed in the audit and migrate as their modules are
touched.

Visibility helpers (`lib/ui/responsive.ts`): `showOn.phone`, `tabletUp`,
`desktop`. Chrome only. Never hide functionality; reflow, collapse, or move it
into a menu or sheet.

## Text, media, tables, technical views

- Titles and names use `[overflow-wrap:anywhere]`; flex children get `min-w-0`. Long names, emails and IDs wrap or truncate deliberately.
- Media respects its container and reserves an aspect ratio.
- Tables keep their own scroll region (MOB-03 redesigns them).
- `TechnicalViewport` and `TechnicalViewportOverlay` give 3D, CAD and drawing surfaces full width, `dvh` height and safe-area-aware overlay controls, without page gutters.

## Accessibility baseline

Semantic HTML; visible 2px focus ring; every icon-only control has a name
(`IconButton` requires `label`); status is text as well as colour (`StatusBadge`);
tooltips only supplement (never the only source of status, action or
validation); 44px touch targets under `touch:`; `prefers-reduced-motion`
handled globally; error states use `role="alert"`; loading states announce
once. Contrast is audited in `docs/a11y/contrast.md` and unchanged here.
