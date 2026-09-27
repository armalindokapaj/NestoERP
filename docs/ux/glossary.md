# NESTO copy and action glossary

AUD-05 §4, UX-07. Derived from the module registry (`config/modules.ts`), the record registry nouns (`lib/core/records/record.registry.ts`, `lib/modules/productivity/navigable.types.ts`) and Quick Create (`config/quick-create.ts`).

The testable part lives in `config/glossary.ts`, and `tests/unit/ux/aud05-glossary.test.ts` holds these to it: the sidebar, module headings, section tabs, Quick Create and dashboard shortcuts.

This glossary covers wording only. Persisted enum values, permission keys, record types, routes and API fields keep their names whatever a label says. For example, the Legal module stays `contracts` at `/contracts`, and `PENDING_APPROVAL` stays `PENDING_APPROVAL` while it displays as "Pending approval".

## Rules

1. **Module names are proper names, in Title Case.** The sidebar, the page `<h1>`, the breadcrumb, the document title and Help all use the same name, for example Daily Logs, QA/QC, Legal.
   - The sidebar and `ModulePage` read one dictionary (`lib/i18n/messages/*` → `modules`), so an Albanian reader sees the same name in all four places.
   - `Breadcrumbs` names the module crumb from that dictionary too.
2. **Record nouns are in sentence case** in running text, buttons, Quick Create, favorites and approvals, for example "Purchase request", "Daily log", "HSE incident".
3. **A list's primary action and its dashboard shortcut say "New <noun>"** with a lowercase noun, for example New task, New invoice, New purchase request.
   - The documented exceptions are listed under Exceptions below.
   - Quick Create lists the bare noun under its "+ Create" heading, for example "Task" and "Purchase request".
4. **One label, one outcome.** A label reaches the same canonical page from the module, a row menu, Quick Create and the dashboard.
   - Dashboard shortcuts take their route and permission from the Quick Create registry (`fromQuickCreate`).
   - A unit test checks that every shortcut and every Quick Create route has a page.
5. **One destination, one name.** A section tab never uses the name of a shell destination (My Work, Favorites, Notifications, Activity, Help).
   - A tab may reuse another module's word only as a scope inside its own module, for example Finance › Approvals, Timesheets › Team, Team › People, HR › Documents.
   - Those tabs are listed in the test, so adding a new one is a decision rather than an accident.
6. **Icons reinforce the text; they never replace it.** The collapsed rail keeps a tooltip and an accessible name. Mobile shows labels.

## Nouns

| Concept | Record (singular / plural) | Where it is listed | Notes |
|---|---|---|---|
| Group | Group / Groups | Organization | The parent organisation. The workspace is called "Group" in the workspace switch. |
| Company | Company / Companies | Organization › Companies | One legal company, with its own workspace and modules. |
| Project | Project / Projects | Projects | Status: Pending, Active, Finished; archived projects are under Archived. |
| Client | Client / Clients | Clients | |
| Unit | Unit / Units | Project › Units | A sellable space: an apartment, shop or parking space. |
| Task | Task / Tasks | Tasks | Status: To do, In progress, Blocked, Completed, Archived. |
| Meeting | Meeting / Meetings | Meetings | |
| Document | Document / Documents | Documents | |
| Expense | Expense / Expenses | Finance › Expenses | |
| Invoice | Invoice / Invoices | Finance › Invoices | |
| Approval | Approval / Approvals | Approvals | A module's own "Approvals" tab is that module's queue. |
| Daily log | Daily log / Daily logs | Daily Logs (the module) | Record is sentence case; the module is "Daily Logs". |
| Purchase request | Purchase request / Purchase requests | Procurement › Requests | Not a purchase order (see Exceptions). |
| Purchase order | Purchase order / Purchase orders | Procurement › Orders | |
| Enquiry (RFQ) | Enquiry / Enquiries | Procurement › Enquiries | "RFQ" is kept as the abbreviation in favorites and search. |
| HSE incident | HSE incident / HSE incidents | HSE › Incidents | Called "Incident" inside HSE. |
| NCR | NCR / NCRs | QA/QC › NCRs | Non-conformance report. |
| Member | Member / Members | Team | A person with a login in this company. |

## Actions

| Action | Label | Outcome |
|---|---|---|
| Create | **New <noun>** (list, dashboard); **<Noun>** under "+ Create" | Opens the canonical create page, with any allowed context filled in. The server validates that context again. |
| Save | **Save changes** (editing) / the form's own submit, e.g. "Create invoice" | Writes the record. Success is shown only after the server confirms it (AUD-09). |
| Submit | **Submit for approval** (finance), **Submit log** (daily logs) | Sends a draft to its reviewers or approvers. |
| Approve / Reject / Return | **Approve** (or "Approve step n"), **Reject**, **Return** | Records the decision. Reject and Return need a reason. |
| Archive / Restore | **Archive**, **Restore** | Hides a record from the working lists and brings it back. Nothing is deleted. |
| Delete | **Delete** | Removes the record. Always asks for explicit confirmation first. |
| Export | **Export** | Downloads the list as filtered (AUD-08). Never a different or mock data set. |
| Help | **Help** (module header), **What is this?** (inline) | Opens checked-in help. Never a tour, and never grants anything. |

## Exceptions (kept on purpose)

- **Purchase request vs Purchase order.** These are different records.
  - A request asks to buy something and is approved.
  - An order is placed with a supplier from an approved request or an enquiry.
- **Add document.** Documents are uploaded or linked, not written. Documents, its dialogs and the dashboard shortcut all say "Add document".
- **Report a hazard / Report an incident.** HSE reports what was seen or what happened. "New incident" would read as if it had been planned.
- **Invite member.** A member is invited and accepts. Nobody is created on their behalf.
- **Request leave.** It asks for a decision.
- **Legal / Contract.** The module is Legal and lives at `/contracts`. Its records are contracts.
- **People / Team / Workforce / Employees.** These are four different views, not four names for one view:
  - People is the group directory.
  - Team is the company's logins.
  - Workforce is everyone employed on site.
  - Employees is HR's employment records.
- **Scoped tabs.** A module can reuse another module's word for a tab inside itself, for example Finance › Approvals, Timesheets › Team, Timesheets › Projects, the Settings tabs, Sales › Tasks, Team › People and HR › Documents. The tab always sits under "<Module> sections". The list lives in the test.

## Replaced in AUD-05

| Was | Now | Where |
|---|---|---|
| Engineering tab "My Work" | "My engineering work" | Clashed with the top bar's My Work (`/my-work`). Now matches the page's own heading. |
| Quick Create "Purchase Request", "Daily Log", "HSE Incident" | "Purchase request", "Daily log", "HSE incident" | Sentence-case record nouns. |
| Dashboard "Create invoice", "Add client", "Purchase request" | "New invoice", "New client", "New purchase request" | Now match the list buttons. |
| Dashboard "Report incident", "Report hazard" | "Report an incident", "Report a hazard" | Now match the HSE buttons. |
| Dashboard "Add team member" → `/team/new` | "Invite member" → `/team/invite` | The old route never existed. |
| Dashboard "Record movement" → `/inventory/movements/new` | "New receipt" → `/inventory/receipts/new` | The old route never existed. |
| Dashboard "New contract" → `/contracts/contracts/new` | → `/contracts/new` | The old route never existed. |
| Dashboard "Raise a request" → `/support/requests/new` | removed | V0.1 has no support request form. |

## Known variance (backlog, not changed)

- **Mixed casing in section tabs.** For example "My Tasks" and "All Tasks" next to "All contracts" and "Low stock".
  - Renaming them would touch list headings, API tests and the public site's Albanian dictionary.
  - Recommendation: move to sentence case in one pass with those callers.
- **Group workspace role badge.** The dashboard's role badge reads the session's anchor membership, while the Group layout follows the person's highest standing (`groupReader`). For a Group Owner whose anchor membership is departmental, the badge could name the department role. This is untested with the seeded data.
