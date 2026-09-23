# Search home, My Work, Quick Create and the Activity Center

Three top-bar features that share a rule: **personal and user-global, never a
door**. Each one shows only what the person can open or do right now, in any
company of their group, whatever the workspace, and every click is authorised
again.

```
Search (empty)  = Favorites + Recent Work   → /my-work for the full history
+ Create        = the canonical create page of each module, prefilled from safe context
🔔 Bell          = Notifications + Announcements in one stream → /activity
```

Source PRDs: *Recent Work, Favorites & Fast Record Re-entry*, *Global Quick
Create & Context-Aware Smart Actions* and *Unified Activity Center:
Notifications + Announcements* (V0.1). The § numbers in the code cite them.

## Shared pieces

| Concern | Location |
| --- | --- |
| Every company of the person's group, whatever the workspace | `resolvePersonalContexts` in `lib/context/workspace-access.ts` |
| Opening a record in its own company (switch only when needed; the workspace route resolver decides the destination) | `components/workspace/use-open-record.ts` |
| Browser caches, keyed by user, cleared on sign-out and demo-user switch; cross-tab `BroadcastChannel` | `lib/productivity/client.ts`, `lib/activity/client.ts` |
| Metrics | `recent_touch_error_total`, `favorite_toggle_error_total`, `search_home_load_ms`, `my_work_load_ms`, `quick_create_launch_denied_total`, `activity_center_load_ms` |

## Fast Re-entry — favorites, recent work, search home, My Work

- **Storage is unchanged** (`UserFavorite`, `RecentItem`, one row per record per
  membership, in the company the record lives in). What changed is reading: the
  lists are user-global — the Company workspace shows another company's record
  too, labelled with its company.
- **Navigable types** (`lib/modules/productivity/navigable.types.ts`): project,
  milestone, task, meeting, daily log, client, document, contract, purchase
  order, invoice, **unit, purchase request, RFQ, QA/QC inspection, NCR, HSE
  incident**. Every page of those records carries the star and records the open.
  Deliberately not navigable: payment and goods receipt (no detail page of their
  own) and employee files (HR-confidential) — `NOT_NAVIGABLE_V01`.
- **Recent work** upserts on every open (one row, `accessCount` +1, newest first).
  Cap 200 per member, retention from the company setting (90 days by default),
  pruned by `recentwork.prune`. Favorites: soft limit 500, never expire.
  References to records that were deleted (or to types no longer navigable) are
  removed daily by `productivity.stale-references`; a record the person merely
  cannot open is kept, since access can come back.
- **Star from search:** a result that is a navigable record carries a star toggle.
- **Search home** (`GET /api/search/home`): 5 favorites + 8 recent, painted from
  the tab's cache and refreshed behind. With a query the panel shows search
  results only; a starred result carries its star. On a phone the search icon
  opens the same panel full screen.
- **My Work** (`/my-work`, `GET /api/my-work`): Recent and Favorites tabs;
  company, module, project, date and text filters as URL state; cursor paging;
  remove one; clear recent (with confirmation). A filter naming something the
  person cannot see is dropped, never answered. `/favorites` redirects here.
- API: `GET /api/my-work[/recent|/favorites]`, `POST /api/my-work/recent/touch`,
  `POST /api/my-work/favorites`, `DELETE /api/my-work/{favorites|recent}/:type/:id`,
  `DELETE /api/my-work/recent`. The PRD #45 routes (`/api/favorites`,
  `/api/recent-work`, `/api/productivity/palette`) still work.

## Quick Create — `+ Create`

- **Registry** `config/quick-create.ts`: one definition per action — module,
  record type, create permission, group, canonical route, ownership, the context
  it consumes and the page parameter for each. Registered: Task, Meeting,
  Document, Project, Daily Log, Client, Opportunity, Invoice, Expense, Purchase
  Request, NCR, HSE Incident. **Not registered:** Purchase Order (raised from a
  request or RFQ, PRD §108). Adding one is a registry entry pointing at a stable
  create page.
- **Service** `lib/modules/quick-create/quick-create.service.ts`: visible =
  module on + create permission + workspace supported + an owning company. In
  the Group workspace each action carries the companies where it may be created
  (and only those). The page's record is read through the record registry in
  the person's scope; it prefills project / client / linked record only for the
  company being created in.
- **Launch** (`POST /api/quick-create/launch`) re-checks everything and returns
  the canonical route plus whether the company must be entered first. The create
  page validates its parameters once more. Errors: `QUICK_CREATE_COMPANY_REQUIRED`,
  `…_COMPANY_FORBIDDEN`, `…_PERMISSION_CHANGED`, `…_UNAVAILABLE`,
  `…_PROJECT_REQUIRED`, `…_PROJECT_INVALID`.
- **UI** `components/layout/quick-create.tsx`: hidden when there is nothing to
  create; the `C` key opens it when no input has focus; Recent (action keys only, `localStorage`), groups, search above eight
  actions; company then project steps; "Creating in: Company · Project"; bottom
  sheet on a phone.
- The dashboard's quick-action tiles that are create actions take their route,
  module and permission from the registry (`fromQuickCreate` in
  `config/quick-actions.ts`); only their wording and icon are their own.

## Activity Center — the bell

- **Read model** `lib/modules/activity/activity-center.service.ts` merges the
  person's own notifications (every company, each company's module switches)
  with the live announcements addressed to them, newest first, cursor-paged.
  Notification and announcement domains are unchanged; this layer creates
  neither. A published announcement's own notification rows are not listed or
  counted beside it, and seeing the announcement reads them.
- **Bell count** = unread notifications + unseen live announcements, each
  counted once per person across memberships. Opening the bell reads nothing.
- **Seen ≠ acknowledged.** Seen = `AnnouncementRead` (on opening the detail, or
  "Mark all"); acknowledged = `AnnouncementAcknowledgment`, only by the explicit
  button. Critical announcements still waiting are held above the stream.
- **Group audience** (`AnnouncementAudienceType.GROUP`, migration
  `20260923180000_announcement_group_audience`): written in one company by an
  author with `announcement.manage_company` and group standing; read by members
  of every active company of the group who hold `announcement.view` there;
  notifications are sent in each recipient's own company.
- **Announcement files are an exception** (product-owner decision, 2026-09-23):
  they are read by everybody who can read the announcement — across the
  companies of the group, and without the Documents grant. They are served only
  by `GET /api/announcements/:id/files/:documentId`, which re-decides the reader
  through the announcement's audience and serves only that announcement's own,
  readable (scanned, not archived) files. The document list, detail, search and
  download routes keep the normal rule.
- API: `GET /api/activity-center`, `GET /api/activity-center/unread-count`,
  `POST /api/activity-center/mark-all-read`, `POST /api/notifications/:id/{read,unread}`,
  `POST /api/announcements/:id/{seen,acknowledge}`. A company filter the person
  cannot use is a 403. `POST /api/announcements/audience-estimate` gives the
  editor a live "Reaches about N people" (a count, never names).
- **Mentions** open at the comment: the notification stores the comment id and
  the link carries `#comment-<id>`; the discussion scrolls to it and highlights it.
- **Pages:** `/activity` (tabs, filters, attention items, load more). `/notifications`
  and the reader tabs of `/announcements` redirect there; `/announcements?tab=manage`
  stays for authors ("Manage announcements" in the bell and on `/activity`);
  `/announcements/:id` is the detail. Announcements left the sidebar
  (`inNavigation: false`).

## Tests

| Suite | Covers |
| --- | --- |
| `tests/api/productivity/fast-reentry.test.ts` | user-global lists and company labels, dedup/top, IDOR, My Work filters/cursor, access loss |
| `tests/api/activity/activity-center.test.ts` | merged stream and count, mark-all vs acknowledge, critical hold, cross-company, foreign filter 403, Group audience |
| `tests/api/jobs/productivity.stale-references.test.ts` | the stale-reference job: idempotency, dry run, company isolation, suspended company, failure |
| `tests/api/quick-create/quick-create.test.ts` | visibility = grants, launch revalidation, Group company choice, cross-company prefill guard, record linking, project step |
