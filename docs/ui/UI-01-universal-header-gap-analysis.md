# UI-01 — Universal header: gap analysis and status

Written 2026-10-09 against the repository at 0a16dd69 plus the UI-01 working tree.
Status words follow PRD §21 Phase 0: **Exists / Partial / Missing / Conflicting**.

## What was found

Three separate authenticated shells, each with its own header:

| Surface | Shell | Before |
| --- | --- | --- |
| Company / Group workspace | `components/layout/app-shell.tsx` + `topbar.tsx` | Search field left, `+ Create`, theme toggle, activity bell, user dropdown |
| Platform Admin (`/admin`) | `components/platform/platform-shell.tsx` | Search field, `+ Create`, locale, theme, profile dropdown; **no bell** |
| Group-only (`/group`) | `components/group/group-shell.tsx` | Locale, theme, name, sign-out button; **no search, no bell, no account panel** |

## Requirement → code

| PRD | State | Where | Notes |
| --- | --- | --- | --- |
| §1/§5 three controls, fixed order, every surface | **Done** (desktop/tablet, all 3 shells) | `components/shell/*`, the three shells | `data-testid="global-actions"` on each cluster; spec `tests/e2e/shell/universal-header.spec.ts`, `roles/topbar-search-position.spec.ts` |
| §8 Search | **Partial** | company `GlobalSearch` (existing backend), `PlatformSearch` (platform, now also group via `/api/group/search`) | Icon trigger + Ctrl/⌘K everywhere. Not built: scope selector, full results page (`/search` exists for company only), cursor pagination, search entity registry, platform-wide recents server-side |
| §9 Notifications | **Partial** | company: existing `ActivityBell`; platform/group: `ContextNotifications` | `Notification` is addressed to a company member, so a Platform Admin / group-only person has no inbox and no producer. Their bell is an honest empty state with no badge. Needs a recipient model that is not a member before it can show events |
| §10 Account panel | **Done** for items that have a real destination | `components/shell/account-panel.tsx` | Order: Profile (identity block), Account Settings, Company Settings, Platform Admin, Appearance, Help, What's New, Sign out. Billing & Plans is deliberately absent — no billing destination or capability exists (§10.4). Group Settings is absent — no group settings page exists. "Platform Admin / Return" is absent — company sessions are never platform sessions (E-06 §116) |
| §10.3 What's New | **Partial** | `config/release-notes.ts`, `/whats-new`, `/admin/whats-new`, `/group/whats-new` | Checked-in entries; no per-user "seen" record, so no "New" indicator |
| §10.3 Help | **Partial** | company `/help` (existing), `/admin/help`, `/group/help` | Surface help is guidance text; no support route is configured so none is shown |
| §6.3 Theme | **Partial** | `applyThemeChoice`, cookie `nesto.theme` | Light/Dark/System work from the panel. Stored in a cookie, **not** against the user: no server preference, no cross-tab sync, not cleared per user at logout |
| §11 Workspace switch | **Reused** | sidebar `OrganizationWorkspaceHeader` | Not repeated in the account panel (user decision 2026-10-09: it is already top left) |
| §12.1 Sign-out | **Reused** | `useSignOut` → `logout()` (dirty-work prompt, session revoke) | Not re-audited against §12.1's offline retry marker |
| §12.2 8-hour expiry warning | **Missing** | | |
| §12.3 Impersonation banner | **Missing / not applicable** | | Demo user switch is logout+login (C-01); no impersonation exists |
| §5 Dimensions/breadcrumbs/tabs | **Exists** | Sticky Navigation PRD (eaa60ed4) | Not re-measured against §5.2 |
| §5.4 One overlay at a time | **Done** | `lib/navigation/panel-host.ts` `OverlayId` | Account joins the existing panel host |
| §13 Platform Admin | **Done** for the header; scoped back-navigation not re-audited | | |
| §14 `/api/me/*` contracts, §16 data, indexing | **Missing** | | Existing endpoints reused; none of the logical contracts were added |
| §17 a11y | **Partial** | Account is a labelled popover (not `role=menu`), radiogroup with arrow keys | No manual screen-reader pass |
| §18/§19 perf, monitoring | **Missing** | | |

## Known gaps in this pass

1. **Phone company shell**: bell stays in the bottom bar and account in More (MOB-02); the three-control top bar is desktop/tablet only there. Platform Admin and Group phones do show all three.
2. Theme is not a per-user server preference (see §6.3 row).
3. No platform/group notification producers; no group-only billing/settings destinations.
4. Search scope selector, full results page for platform/group, search registry.
5. No session-expiry warning, no cross-tab logout broadcast verification.
6. Full E2E suite not run; only the specs named above plus changed locators.

## Verification run

* `tsc --noEmit` clean.
* New E2E `tests/e2e/shell/universal-header.spec.ts` (Platform Admin, group-only CEO: cluster order, panel entries, theme radio, Help/What's New pages, group-scoped search + 403 for a platform session, sign-out then Back) — 2/2 pass on a scratch database.
* `topbar-search-position` rewritten for the cluster, `language-preference` — pass.
* Locators for the old user menu (`open user menu`, `Logout` menuitem) migrated to `account-trigger` / `account-sign-out` across 13 spec files; not all of those specs were re-run.
* Unit/architecture: 7 failures, identical at baseline (ownership, state, audit-coverage ×2, aud11 palette, client-lifecycle, form-manifest).
* `verify-authorization`: `/api/group/search` is flagged "does not run inside withContext", exactly as the existing `/api/group/command` and `/api/group/eligible-users` are (the script has no group wrapper).
