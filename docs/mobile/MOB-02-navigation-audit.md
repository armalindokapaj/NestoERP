# MOB-02 navigation audit

Taken 2026-09-30 before any MOB-02 change. Everything MOB-02 needed already
exists except the phone presentation, so this audit is mostly a map of what to
reuse.

## One navigation authority (already true)

| Concern | Where | Notes |
|---|---|---|
| Module registry | `config/modules.ts` | Every module: route, icon, group (`primary`, `work`, `department`, `company`), view permission, sections. `inNavigation: false` keeps a module out of navigation (Announcements). |
| Navigation resolver | `config/navigation.ts` `resolveNavigation` | Module enabled for the company, then the person holds the permission, then empty groups dropped. Edge-safe. |
| Workspace scoping | `lib/workspace/navigation.ts` `resolveWorkspaceNavigation`, called once in `components/layout/app-shell.tsx` | Result is handed to sidebar and drawer alike. |
| Active destination | `activeNavigationKey`, `isNavigationItemActive` | By longest route, so `/projects/123/units/42` keeps Projects active. |
| Route guards | `middleware.ts`, module layouts | A URL for a disabled or forbidden module is refused server-side whatever the UI shows. |
| Desktop presentation | `components/layout/sidebar.tsx`, `sidebar-nav.tsx` | Rail 1024-1199, full sidebar from 1200. |
| Tablet/phone presentation before MOB-02 | `mobile-header.tsx`, `mobile-nav.tsx` | Hamburger opening a left drawer with the same `SidebarNav`. |
| Top bar | `topbar.tsx` | Search, Create, bell, account. |
| Workspace switching | `organization-workspace-header.tsx` (variant `drawer` is a bottom sheet), `workspace-panel-body.tsx`, `workspace-switch-provider.tsx` | Authorised options come from the server (`listWorkspaces`); route fallback logic lives with the switch. |
| Search | `global-search.tsx` + `/api/search` | Full-screen dialog on a phone. Backend applies company, module, permission and record scope. |
| Notifications | `activity-bell.tsx` | Full-height sheet on a phone. |
| Quick Create | `quick-create.tsx`, `/api/quick-create/actions`, `config/quick-create.ts` | Bottom sheet on a phone; actions and context prefill come from the server per route. |
| Profile and sign-out | `user-menu.tsx` (`/settings/profile`, `/settings`, logout) | Sign-out asks about unsaved work first. |
| Breadcrumbs and back | `components/ui/breadcrumbs.tsx`, `config/breadcrumb-routes.ts`, `record-navigation-provider.tsx` | Phones already show `‹ parent   current`; Back uses tab history or the nearest parent on a deep link. |
| Unsaved work | `components/unsaved/*`, `nav-link.tsx` | Every `Link` asks `unsaved.requestDeparture` first; browser back and workspace switch are held too. |
| Pending and prefetch | `navigation-feedback.tsx`, `intent-prefetch.tsx` | `intent` links prefetch on deliberate intent only; `usePendingDestination` marks a tapped item. |
| Panels | `lib/navigation/panel-host.ts` | One overlay at a time (search, create, activity, workspace). |
| Demo impersonation | `dev-user-switcher.tsx` (logout + login) | Full session change, so the shell re-renders as the target user. |

There is no second navigation registry, and MOB-02 adds none.

## Gaps

1. Phones used the tablet drawer: a sidebar behind a hamburger. No bottom navigation, no More, no compact context header.
2. The account menu and Create competed for header width at 320px.
3. Nothing reserved room for a bottom bar or let it step aside for a form's action bar or the keyboard.
4. No seam for navigation analytics events.

## Decisions

- **Presentation adapter, not a config.** `lib/navigation/mobile.ts` `resolveMobileNavigation` takes the groups the resolver produced and returns `{ primary, more }`. It cannot add an item. Which modules are primary is `mobilePriority: "primary"` on the module definition (dashboard, projects, tasks).
- **Below lg, a bottom bar.** From lg the desktop sidebar is unchanged. Phone (<768): workspace context, search and bell in the header; Home, Projects, Tasks, Create, More in the bar. Tablet portrait (768-1023): the bar plus the existing top bar (hamburger drawer, Create, account menu).
- **Reuse the panels.** Create raises an event the existing Quick Create listens to; search and the bell keep their triggers; the workspace sheet is the existing drawer-variant header rendered in the top bar.
- **Sign-out is one hook** (`use-sign-out.ts`) shared by the account menu and More.
- **Back hierarchy is the existing breadcrumb bar.** No parallel stack.
- **Deferred:** per-module badge counts in More (no cheap canonical count exists; MOB-06 adds daily counters), a mobile search redesign (MOB-03), per-record project switching (MOB-05).
