> **Chat:** Nesto — mobile for the site team
> **File:** docs/ui/UI-09-admin-console.md
> **About:** The Admin Console redesign — the company app's shell around six areas by task, a new search palette and an operations cockpit for Home — what it does, how it looks, where it lives and what is left for the next waves, for whoever changes the console next.
> **Last updated:** 2026-11-13 (wave 3: settings and operations, §6)

# UI-09 — Admin Console: the company app's shell, six areas by task

The console had its own shell: a sidebar of eight pill-shaped links, a tall
empty top band, tab rows of up to fifteen tabs that ran off the screen and
sat above the title on some pages and below it on others, a Home whose hero
took 40% of the first screen, a floating rounded bar on a phone, and a glass
search panel. Nothing in it worked the way the company app does.

Decided with the owner on 2026-11-12: the same layout and function as the
company app; the pages grouped by task into six areas; Home an operations
cockpit; delivered in waves, each merged.

- **Wave 1:** the shell, the navigation, search, Home.
- **Wave 2:** the list pages, and the organization, user and project hubs.
- **Wave 3:** the settings and operations pages, and every page head left.

## 1. The areas

Every page once, by what it is for (`components/platform/admin-navigation.ts`):

| Area | Sets and pages |
| --- | --- |
| **Home** | Overview · Help · What's new |
| **Customers** | Organizations: Organizations, Projects · Subscriptions: Entitlements, Plans, Pricing |
| **People & access** | Accounts: Accounts, People, Memberships · Access: Roles, Permissions, Access grants, Access inspector · Sign-ins: Sessions, Mobile devices |
| **Product** | Modules: Catalog, Templates, Feature flags · 3D / Rozaris: Experiences, Model library, Publishing, 3D diagnostics |
| **Operations** | Health: Health, Jobs, Storage, Data diagnostics · Messages: Email, Notifications, Integrations · Care: Maintenance, Recovery, Support, Settings |
| **Security** | Audit: Audit log, Security events, Access changes, Failed sign-ins · Policy: Authentication, Security policy, Mobile policy |

A page is offered only to somebody who holds its permission; an area with no
page left is not drawn. The page a path is under is found by hierarchy, so
`/admin/organizations/<id>/departments` is Organizations; Overview is the
root alone. Words are in `admin.nav.area.*`, `admin.nav.set.*` and
`admin.nav.page.*`, in English and Albanian.

## 2. The shell

`components/platform/admin-shell.tsx`, the company app's shell
(docs/ui/UI-04-navigation-layouts.md) around these areas.

**From lg** — one top bar, the three columns of the company app:

    [ logo · NESTO Platform ]   ( Customers | People & access | Product | Operations | Security )   [ Search…  Ctrl+K · bell · account ]

- **The logo** opens every page by area on the left third of the screen, with
  a field that finds a page by name.
- **NESTO Platform** is Home: the Overview.
- **The five areas** are the Ribbon's tabs (`components/layout/ribbon.tsx`,
  now shared: each shell hands it a `RibbonModel`). The open tab's pages stand
  under the bar in captioned sets; the open tab folds it away, as in the
  company app, and the cookie is the same one.
- **Search, the bell, the account**, the universal cluster in its order.
- **Create** is the dial at the bottom right: a pointer resting on the +, a
  keyboard landing on it, or a click fans out Company, Group and Project, each
  opening its directory's create form (`?create=`).

The breadcrumb line ("NESTO Admin") stays at the head of each page. The old
sidebar, its drawer, the per-page tab rows and the floating bar are gone; the
pages that had tab rows are reached from the Ribbon instead.

**Below lg** — as the company app's phone:

- **The bar at the top**: the page's name, with Back on a page deeper than the
  navigation (an organization, a user: up to the page it is under; Account: to
  Menu); then search and the bell in cells of their own.
- **The bar at the bottom**: Home · Customers · New · People · Menu. Customers
  and People open their area's first page and are marked anywhere in their
  area; New, in ink, opens what this person may create in the phone's sheet.
- **Menu** (`/admin/menu`, `components/platform/admin-menu.tsx`): you (to
  Account); a field that finds any page; Home's pages; the five areas as lines
  that open in place, their pages in the Ribbon's sets; Day or Night, the
  language, Help and Sign out.

## 3. Search

`components/platform/admin-search.tsx`, the company app's palette
(docs/ui/UI-08-search.md) for the console: centred, 720px wide, from 640px;
the whole screen with Cancel on a phone. One field finds:

- **Records** from `/api/platform-admin/search`: groups and companies,
  projects, users and people, each opening its own page; recent picks are kept
  in this browser.
- **Pages** from the person's own navigation, with the area they are in.
- **Create** actions: Company, Group, Project.

Filters under the field: All · Organizations · Projects · Users · Pages; Tab
and Shift+Tab step through them. With nothing typed, All shows recent picks
and Create, Pages every page by area. The trigger keeps the testid
`admin-search-trigger` and the palette `admin-search`.

## 4. Home: the operations cockpit

`app/admin/page.tsx` and `app/admin/_dashboard/sections.tsx`. A page head like
every other page (Overview, who and the date, Refresh) instead of the hero,
then numbered lined panels, each streaming and failing on its own:

1. **Health** — the eight services (`platformHealth`) in one strip with their
   state; a line above says how many need a look. Opens Health. Without
   operations access it says so.
2. **In numbers** — organizations, projects and users, each opening its list.
3. **Attention required** — the current problems, worst first.
4. **Recent activity** — beside it from xl, the time at the right.
5. **Organizations** and 6. **Projects** — the newest of each.
7. **Platform usage** — storage, module provisioning, 3D.

## 5. Lists and hubs (wave 2)

The console's lists and records are drawn as the company app's, from one set
of pieces (`components/platform/admin-list.tsx`):

- **A list** — Organizations, Projects, Accounts, Entitlements — is a lined
  frame: the table from md, and below it compact lines as Sales units' on a
  phone (name, what it belongs to, a line of facts, the status badge, a
  chevron; the whole line opens the record). Every table row opens its
  record too. The foot carries the count in mono capitals and square
  previous and next steps with "page n of m".
- **Views** (All · Groups · Companies · Standalone; By organization · By
  module) are the context tab row from lg and the phone's section row under
  the top bar below it, as in the company app. The shell now has that row
  and the page's ⋯ menu.
- **Choices** that were rounded pills (ownership, 3D, scope, plan) are one
  segmented control: square cells sharing their lines, the chosen one in
  ink.
- **Hubs** — an organization, an account, a project — have the record
  header every record page has (breadcrumb, title in the display face, the
  line under it, status, actions) and their sections in the context tab row.
- **Panels.** Panel headings across the console are mono section heads; a
  record's own name and an empty state's sentence keep the ordinary face.
  Tables inside panels run edge to edge instead of sitting in padding.

## 6. Settings and operations (wave 3)

- **Health** is the same lined grid as Home's strip
  (`components/platform/admin-health.tsx`), four across, each service with
  its state in words (Healthy, Degraded, Down, Not reporting) and what was
  checked.
- **The Audit log** is a list like the others — the table from md, compact
  lines on a phone, every row opening its event, the count and pages at the
  foot. On a phone its filters fold behind one "Filters" line with how many
  are set (`components/platform/admin-filter-toggle.tsx`), so the events start
  on the first screen; from 640px they stand in their row.
- **Panels with a title and a table** (Jobs, Notifications) have the title in
  a head bar and the table edge to edge; a fact's label is a mono eyebrow.
- **Every page head left** — an audit event, one company's entitlements (now
  with its sections in the tab row), Departments, the Platform Admin's own
  Account — is the shared header, the title in the display face; the 3D
  project's title too.
- **Bold capitals** in the user drawers became mono section heads; the
  password notice's action is ink, not gold.

## 7. Where it lives

| Piece | File |
| --- | --- |
| Areas, pages, permissions, phone places, Back | `components/platform/admin-navigation.ts`, `tests/unit/platform/admin-navigation.test.ts` |
| Shell: top bar, logo panel, Ribbon model, dial, phone bar | `components/platform/admin-shell.tsx` |
| Menu | `app/admin/menu/page.tsx`, `components/platform/admin-menu.tsx` |
| Search | `components/platform/admin-search.tsx` |
| The shared Ribbon | `components/layout/ribbon.tsx` (`RibbonModel`); the company app builds its model in `components/layout/topbar.tsx` |
| The phone title's Back for a shell without record history | `components/layout/phone-title.tsx` (`up`) |
| Home | `app/admin/page.tsx`, `app/admin/_dashboard/sections.tsx`, `app/admin/loading.tsx` |
| Lists and hubs: frame, lines, tabs, choices, foot | `components/platform/admin-list.tsx` |
| Health grid; filters folded on a phone | `components/platform/admin-health.tsx`, `components/platform/admin-filter-toggle.tsx` |
| Words | `lib/i18n/modules/admin/{en,sq}.ts` (`shell`, `nav`, `search`, `dashboard`) |

## 8. What is left

- The pages' tables inside a hub's tabs (an organization's users, roles,
  modules) still stack on a phone rather than turning into compact lines.
- The 3D pages (Experiences and a project's 3D workspace) keep their own
  layout inside the shell.
- The Group console (`components/group/group-shell.tsx`) keeps its own shell
  and glass search.
