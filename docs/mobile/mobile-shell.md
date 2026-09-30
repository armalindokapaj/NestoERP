# Mobile shell (MOB-02)

```
AppShell
├── Sidebar (lg and up)                      unchanged
├── Topbar
│   ├── MobileHeader
│   │   ├── phone (<768)    workspace context (OrganizationWorkspaceHeader "drawer")
│   │   └── tablet (768-1023) hamburger drawer + organization mark
│   ├── GlobalSearch, QuickCreate (from md), ActivityBell
│   └── UserMenu (from md)
├── BreadcrumbBar                            back / current on a phone
├── PageContainer <main>
└── MobileBottomNav (below lg)
    ├── bar: up to three primary destinations, Create (phone), More
    └── More sheet (BottomSheet): account, module search, groups, Settings, sign out
```

One shell, one tree per width decided in CSS. Nothing branches on the user
agent or `window.innerWidth`.

## Widths

| Width | Shell |
|---|---|
| < 768 | Compact header (context, search, bell). Bottom bar with Create. Account in More. |
| 768-1023 | Existing header with drawer, Create and account menu. Bottom bar without Create. |
| >= 1024 | Desktop sidebar. No bottom bar. |

Decisions use the viewport, not the device: a foldable or a split-screen window
gets whatever its width says.

## Header

Progressive context, never the whole hierarchy: the organization and the
workspace on two short lines (`ARMAAR` / `Eyes of Tirana` style). Tapping it
opens the workspace sheet (search, group, companies, selected state) through
the existing switch, which validates access on the server and asks about unsaved
work. The full trail is in the breadcrumb bar below.

## Bottom bar

- `<nav aria-label="Primary">`, items are links with `aria-current="page"`, an accent bar and heavier icon for the active one.
- Clears the home indicator with `--nesto-safe-bottom`; 56px plus the inset.
- Content clearance is `--nesto-bottom-nav-space`, added by `.nesto-page` and mirrored in `--nesto-bottom-reserve` (toasts, focus scrolling). Modules add no bottom padding.
- Steps aside (CSS `html:has(...)`) while a form's `data-sticky-action-bar` is on the page (one bottom bar at a time) and while a text field has focus (the keyboard needs the height). With `interactive-widget=resizes-content` the bar rides above the keyboard on Android otherwise.
- z-index is the lowest shell layer (`--nesto-z-shell-tabs`, 28), under the top bar (30), so the Create, Search and Activity panels, which live inside the top bar's stacking context, cover it; drawers, sheets, dialogs, menus and toasts are above it too, and a modal also makes it inert.
- Primary links are `intent` links: prepared on deliberate hover or focus, never in bulk. A tapped destination shows the pending dot immediately; the router ignores a second activation.

## Create

`Create` dispatches `nesto:open-quick-create`. The existing Quick Create panel
opens as its usual bottom sheet with the actions the server returns for this
person and route, so project and unit prefill work as on desktop. The bar hides
the button when the person has nothing to create.

## More

`BottomSheet` titled "More". Groups follow the existing information architecture
(General, Work, Department, Company); leftover primary-group items (Calendar,
Approvals) sit under General. "Search modules" appears when more than eight
destinations are listed and filters navigation labels only. Settings and sign
out sit at the foot; the profile row leads. Category placement carries no
authorization meaning: an item is in the list only because the resolver
permitted it.

## Analytics seam

`lib/navigation/analytics.ts` `emitNavigationEvent` dispatches
`nesto:navigation-event` on `window`: `navigation_destination_opened`,
`quick_create_opened`, `more_opened`. (`workspace_switched` and
`global_search_opened` are named for the owners of those flows to emit.) No
dependency, no payload beyond ids.

## Motion and accessibility

Sheets use the shared, reduced-motion aware animations. Every control is a real
button or link with a visible name; focus returns to the trigger when a sheet
closes; targets are 44px or more.
