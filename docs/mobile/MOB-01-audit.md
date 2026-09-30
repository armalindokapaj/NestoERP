# MOB-01 repository audit

Taken 2026-09-30 at HEAD 801a8f60, before any MOB-01 change. It records what the
repository already had, so MOB-01 extends it instead of duplicating it. The
AUD-04 work (`docs/mobile/coverage-manifest.md`) is the earlier responsive pass;
this audit only covers what MOB-01 asks about.

## Stack

- Next.js App Router, React, **Tailwind CSS v4** (`@import "tailwindcss"` in `styles/globals.css`, `@theme inline` block, `@custom-variant`). No `tailwind.config`.
- Radix primitives for Dialog, Popover, Dropdown, Select, Toast, Tooltip.
- Vitest runs in the `node` environment on `tests/**/*.test.ts`. Playwright drives real routes; `playwright.config.ts` already has the AUD-04 viewport matrix (320, 360, 390, 768, 820, 844x390, 1024, 1280, 1440) for specs named `responsive/aud04-*.spec.ts`.

## What already exists (kept, not rebuilt)

| Area | Where | State |
|---|---|---|
| Tokens | `styles/tokens.css` | Colour, shadow, motion, shell dimensions, one z-index ladder. Light/dark through `light-dark()`. |
| Breakpoints | `@theme` in `globals.css` (sm 640, md 768, lg 1024, xl 1200, 2xl 1440); `BREAKPOINTS` in `components/ui/use-breakpoint.ts`; `theme.breakpoints` in `config/theme.ts` (drift-tested) | One set of numbers, no `xs`. |
| Touch variant | `@custom-variant touch` (below 1024 or coarse pointer) | Used by Button, Input, Checkbox, Switch, Dialog close, Dropdown rows, Toast close: 44px hit areas. |
| Sticky stack | `--nesto-shell-header-h`, `--nesto-shell-breadcrumb-h`, `--nesto-shell-tabs-h`, `--nesto-sticky-stack` | Shell only. Pages hardcode their own `sticky` offsets. |
| Bottom reserve | `html:has([data-sticky-action-bar])` sets `--nesto-bottom-reserve` | Used by toast placement and `scroll-padding-bottom`. Five modules hand-roll the bar. |
| Safe areas | `viewportFit: "cover"`, `env(safe-area-inset-*)` written inline in Dialog, Drawer, Toast, app shell | No tokens; the expression is repeated. |
| Dynamic viewport | `dvh` in Dialog, Drawer, shell | `100vh` remains only in `styles/project-viewer.css` (3D viewer, other session). |
| Dialog | `components/ui/dialog.tsx` | Centred, `max-h` clamps to dvh less insets, 44px close. **No full-screen phone presentation** except a hand-written override in `global-search.tsx`. |
| Drawer | `components/ui/drawer.tsx` | left / right / bottom, safe-area padding, focus rules, unsaved-work guard. |
| Popover / Dropdown / Select | `components/ui/popover.tsx` etc. | Radix collision handling. Dropdown caps its height to the room Radix measured; **Popover does not**. |
| Toast | `components/ui/toast.tsx` | Fits phone width, clears the sticky action bar and home indicator. Long titles do not force a wrap rule. |
| Loading | `components/ui/loading-state.tsx`, `skeleton.tsx` | `SkeletonCards`, `SkeletonTable`, `SkeletonPage`. **No list, form or single-card skeleton; no inline / button loader.** |
| Empty / error | `empty-state.tsx`, `error-state.tsx` | One empty state, one error state. **No inline, section, network, permission or not-found variants.** |
| Status | `components/modules/status-badge.tsx` on `components/ui/badge.tsx` | Text always present. Badge is `whitespace-nowrap`: a long label cannot wrap. |
| Page shell | `components/layout/app-shell.tsx` `<main>` | Page gutters written as a long class string; no shared primitive. |
| Page header | `components/ui/page-header.tsx` | Actions wrap; title breaks anywhere. |
| Card | `components/ui/card.tsx` | Fixed `px-5`; no selected, disabled, interactive, compact or status state. |
| JS viewport | `components/ui/use-breakpoint.ts` (`useMediaQuery`, `useIsBelow`, `useIsTouch`, shared stores, SSR-safe) | The canonical hook. **No `useResponsive()` bundle.** |
| Overflow guard | `tests/e2e/responsive/geometry.ts` `expectNoPageOverflow` | Exists and is used per module. **No MOB-01 route sweep.** |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` in `globals.css` | Global; the only `!important` use worth keeping. |
| Contrast | `docs/a11y/contrast.md`, `tests/unit/a11y/contrast.test.ts` | Audited pairs in both schemes (AUD-11). Not changed here. |

## Findings

### Duplicates of the JS viewport check

Found by grepping `matchMedia` / `innerWidth`:

- `lib/hooks/use-media-query.ts` — older `useMediaQuery` returning `false` on the server. Its only importer is `components/layout/sidebar-provider.tsx`.
- `components/calendar/use-is-phone.ts`, and inline `matchMedia` in `calendar-shell.tsx`, `daily-log-workspace.tsx`, `document-file-panel.tsx`, `approval-detail.tsx`, `pricing-wizard.tsx`.
- `components/3d/viewer/hooks/useMediaQuery.ts`, `MobileUnitsSheet.tsx`, `UnitPreviewCard.tsx`, `ExperienceEditor.tsx`, `lib/3d/runtime/**` — the 3D module, owned by another session.
- `components/project-planning/planning-timeline.tsx` reads `innerWidth`.

These are recorded, not migrated in MOB-01, because moving each changes module behaviour. `useResponsive()` is the replacement new code must use.

### Z-index

Numeric `z-[N]` literals in `app/` and `components/`: 60 (nine, dialogs), 65 (three), 70, 66, 55, 50, plus 80 and **85** (unsaved-work prompt and its overlay), **90** (skip link), **100** (3D `ViewerDiagnostics`, dev only), and `z-[1]`/`z-[5]` (sticky first column and SVG inside their own table or timeline). The ladder in `tokens.css` names 30 to 80. 85 and 90 are deliberate "critical" layers above the prompt; MOB-01 names them `--nesto-z-critical` in the docs and does not renumber them.

### Fixed widths and heights

- `100vh`: three lines in `styles/project-viewer.css` (3D viewer; other session).
- `h-screen`, `min-h-screen`: none in `app/` or `components/`.
- `max-w-[calc(100vw-1rem)]` and `w-[calc(100vw-2rem)]` in Dialog, Dropdown, unsaved prompt: intentional viewport clamps.

### Hover dependence

`group-hover:` appears in 24 files. The ones checked reveal a secondary affordance (row highlight, a redundant action). Not audited file by file in MOB-01; the rule and a checklist are in `component-guidelines.md`, and MOB-03 (tables) is where row actions are reworked.

### Other

- `!important`: 14 uses in `styles/`, all the reduced-motion reset or the 3D viewer stylesheet.
- Container queries (`@container`, `@sm:`): none used yet.
- Sticky/fixed elements: top bar, breadcrumb bar, context tabs (shell vars); sticky bottom action bars in `timesheet-week`, `daily-log-workspace`, `project-form`, `announcement-detail`, `meeting-workspace`; sticky first table columns in timesheets and procurement.
- Portals: every Radix overlay portals to `body`; the ladder keeps menus above dialogs.
- Viewport meta has no `interactiveWidget`, so the Android keyboard overlays fixed bars.

## Gaps MOB-01 closes

1. Semantic responsive tokens (`--nesto-space-page-x` and friends, safe-area tokens, control heights, semantic z names).
2. `xs` breakpoint (480) so the PRD's six ranges exist in CSS and in `BREAKPOINTS`.
3. `PageContainer`, `Stack`, `ResponsiveGrid` / `FormGrid`.
4. `IconButton`, `Button` loading state.
5. Card states.
6. `BottomSheet`; Dialog phone presentations; Popover viewport cap.
7. `StickyStack` with `StickyHeader`, `StickySubHeader`, `StickyTabs`, `StickyActions`.
8. Skeleton list / form / card, `InlineLoader`.
9. Error variants: page, section, inline, network, permission, not-found.
10. `TechnicalViewport`.
11. `useResponsive()`, responsive visibility helpers, input-mode presets.
12. Viewport `interactiveWidget`.
13. A route-level overflow sweep on the AUD-04 matrix, unit tests, documentation.

## Explicitly not done in MOB-01

Migrating the duplicate viewport hooks listed above; the 3D module; table redesign (MOB-03); navigation shell (MOB-02); replacing the five hand-rolled action bars (they keep working with `data-sticky-action-bar`; `StickyActions` is the target for new code).
