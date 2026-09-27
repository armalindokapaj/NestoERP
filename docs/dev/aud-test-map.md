# AUD test-to-requirement map

Every AUD-01..AUD-12 acceptance ID, and the files under `tests/` and `scripts/verify-*` / `scripts/check-*` that name it.

**How it was built.** A literal search for each ID (for example `grep -rlE "\bFA-07\b" tests scripts`), generated on 2026-09-27 against `main` at 33ba6f61 plus the uncommitted AUD-12 work. So:

- a file listed here *mentions* the ID, usually in a `describe`/`test` title or a comment. It is evidence to look at, not proof the requirement passes;
- **GAP** means no test or verifier names the ID. The requirement may still be covered by a test that does not cite it, by a manual/measured check recorded elsewhere (`docs/release-readiness.md`, `docs/perf/`, `docs/a11y/`), or not at all. Each gap needs one of: a test that cites it, a pointer to the evidence, or an accepted exception;
- regenerate after adding tests; do not hand-edit the file lists.

The acceptance text is abbreviated from the PRDs.

## AUD-01 Finance accuracy

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| FA-01 | 60 invoices; first 25 unpaid, sole paid record at original position 40 | `tests/api/finance/finance-accuracy.test.ts`<br>`tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-02 | Repeat FA-01 for expenses and both Group/Company contexts | `tests/api/finance/finance-accuracy.test.ts` |
| FA-03 | Total 100; no allocations / live 40 / live 100 | `tests/api/finance/finance-accuracy.test.ts` |
| FA-04 | Sent overdue total 100, paid 40; frozen time | `tests/api/finance/finance-accuracy.test.ts` |
| FA-05 | Due date before/equal/after clock; past-due draft; archived record | `tests/api/finance/finance-accuracy.test.ts` |
| FA-06 | Void/reverse an allocation, or leave payment unallocated | `tests/api/finance/finance-accuracy.test.ts`<br>`tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-07 | One payment split among records; invoice+installment on one allocation | `tests/api/finance/finance-accuracy.test.ts` |
| FA-08 | Zero-total valid invoice; historical overpayment | `tests/api/finance/finance-accuracy.test.ts` |
| FA-09 | Paid+partial filter with search, currency, project and dates | `tests/api/finance/finance-accuracy.test.ts` |
| FA-10 | Duplicate dates/amounts/numbers across companies; page traversal | `tests/api/finance/finance-accuracy.test.ts` |
| FA-11 | Page 999, negative/invalid page, zero matches, last row removed | `tests/api/finance/finance-accuracy.test.ts`<br>`tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-12 | EUR 100/40/60 and ALL 1000/200/800 | `tests/api/finance/finance-accuracy.test.ts` |
| FA-13 | Authorized and foreign company/project/client; disabled Finance; view-only user | `tests/api/finance/finance-accuracy.test.ts`<br>`tests/api/finance/finance-export.test.ts` |
| FA-14 | Mixed Group read/export permissions | `tests/api/finance/finance-export.test.ts` |
| FA-15 | Frozen dataset; export from page 2 with combined filters | `tests/api/finance/finance-export.test.ts`<br>`tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-16 | Export 0, 10,000 and 10,001 matches | `tests/api/finance/finance-export.test.ts`<br>`tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-17 | Formula-like names, quotes, commas, newlines and Albanian text | `tests/api/finance/finance-export.test.ts` |
| FA-18 | Payment changes while one list/export is executing | `tests/api/finance/finance-accuracy.test.ts` |
| FA-19 | DB/export timeout and retry | `tests/api/finance/finance-accuracy.test.ts`<br>`tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-20 | Phone/tablet/desktop; keyboard; Back; Refresh | `tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-21 | Seeded Finance user vs user lacking invoice/expense permissions | `tests/api/finance/finance-export.test.ts`<br>`tests/e2e/modules/finance-accuracy.spec.ts` |
| FA-22 | Query plans and 10-user load at specified volume | `tests/perf/finance-registers.perf.test.ts` |

## AUD-02 Task reliability

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| TR-01 | Existing/new tasks after migration/create | `tests/api/tasks/task-reliability.test.ts` |
| TR-02 | Edit one task at current version | `tests/api/tasks/task-reliability.test.ts` |
| TR-03 | Two edits released together from version N | `tests/api/tasks/task-reliability.test.ts` |
| TR-04 | Edit versus Complete; Edit versus Archive | `tests/api/tasks/task-reliability.test.ts` |
| TR-05 | Start versus Block; Complete versus Reassign | `tests/api/tasks/task-reliability.test.ts` |
| TR-06 | Two archive or restore requests | `tests/api/tasks/task-reliability.test.ts` |
| TR-07 | Restore completed/blocked task; legacy null preArchiveStatus | `tests/api/tasks/task-reliability.test.ts` |
| TR-08 | Same-version no-change edit, stale no-change edit, repeated state action | `tests/api/tasks/task-reliability.test.ts` |
| TR-09 | Missing, zero, fractional, negative, malformed and forged version | `tests/api/tasks/task-commands-http.test.ts`<br>`tests/api/tasks/task-reliability.test.ts` |
| TR-10 | Ordinary status edit bypass attempt; block reason boundaries; reopen target | `tests/api/tasks/task-reliability.test.ts` |
| TR-11 | Foreign task/company/project, disabled module, lost membership, viewer | `tests/api/tasks/task-reliability.test.ts` |
| TR-12 | Two assignee changes; inactive/foreign/ineligible target; revoked assignment rights | `tests/api/tasks/task-reliability.test.ts` |
| TR-13 | Source-linked project move; valid independent project move | `tests/api/tasks/task-reliability.test.ts` |
| TR-14 | Mandatory activity/outbox/meeting-sync failure | `tests/api/tasks/task-reliability.test.ts` |
| TR-15 | Subscription/delivery failure after commit | `tests/api/tasks/task-reliability.test.ts` |
| TR-16 | Double click and lost response replay | `tests/api/tasks/task-reliability.test.ts` |
| TR-17 | Review conflict, reapply selected fields, another intervening edit | `tests/api/tasks/task-reliability.test.ts`<br>`tests/e2e/modules/task-reliability.spec.ts` |
| TR-18 | Reassignment removes actor visibility | `tests/api/tasks/task-reliability.test.ts`<br>`tests/e2e/modules/task-reliability.spec.ts` |
| TR-19 | Comment/attachment/read changes while edit is open | `tests/api/tasks/task-reliability.test.ts` |
| TR-20 | Linked meeting handoff, status change and reassignment | `tests/api/tasks/task-reliability.test.ts` |
| TR-21 | Two sessions with different roles; API versus server action | `tests/api/tasks/task-commands-http.test.ts` |
| TR-22 | Mobile/keyboard reason and conflict dialogs; validation/network failure | `tests/e2e/modules/task-reliability.spec.ts` |
| TR-23 | Concurrent writers on different tasks | `tests/api/tasks/task-reliability.test.ts` |
| TR-24 | Old client after coordinated cutover; seed rerun; trusted integration | `tests/api/tasks/task-reliability.test.ts` |

## AUD-03 Unsaved work

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| UW-01 | Clean load/default hydration and read-only filters: no prompt or dirty state. | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-02 | Text, select, checkbox, date, rich text, line items and file changes are detected; restoring baseline clear… | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/dirty-and-outcome.test.ts` |
| UW-03 | Two dirty editors: saving/unmounting one cannot clear the other's protection; Strict Mode causes no duplica… | `tests/unit/unsaved/coordinator.test.ts` |
| UW-04 | Sidebar, breadcrumb, search, notification, mobile menu and programmatic route changes: Stay preserves route… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-05 | Ctrl/Cmd/middle click, independent new-tab links, downloads, anchors and hover/prefetch do not spuriously p… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-06 | Browser Back/Forward and repeated/swipe traversal: Stay restores consistent URL/page/draft, continue reache… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-07 | Reload/tab close/external departure request native protection when supported; clean/successfully saved form… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-08 | Dialog X, Escape, backdrop, Cancel, nested close and implemented swipe: warning Stay leaves the original ed… | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/coordinator.test.ts` |
| UW-09 | Save and continue validates, commits once and follows original intent; invalid data retains input, focuses… | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/coordinator.test.ts` |
| UW-10 | Client duplicate warning is not auto-accepted; Send/Approve/Publish cannot be triggered by a generic Save a… | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/coordinator.test.ts` |
| UW-11 | Several editors: review individually; partial successful saves remain persisted; no silent all-or-nothing p… | `tests/unit/unsaved/coordinator.test.ts` |
| UW-12 | 422/business refusal, confirmed 500, network loss and conflict preserve draft; unknown outcome is distingui… | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/coordinator.test.ts`<br>`tests/unit/unsaved/dirty-and-outcome.test.ts` |
| UW-13 | Save double click/Enter and departure while saving produce at most one request; newer edits cannot be marke… | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/coordinator.test.ts` |
| UW-14 | Save succeeds but route load fails: draft baseline is clean and Retry navigation does not save/create again. | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-15 | Background refresh changes server data: dirty local fields are not overwritten; Task conflict resolution re… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-16 | Workspace Stay issues zero switch mutations; Save executes in original company, then switch; failed switch… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-17 | Workspace timeout/ambiguous response freezes writes until canonical context is known; old draft never appea… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-18 | Second tab switches while first is dirty: no blind draft-destroying reload; review requires authorized retu… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-19 | Voluntary logout/impersonation is guarded; forced expiry/revocation blocks writes; different identity never… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-20 | Back/forward-cache restoration and missing BroadcastChannel support reconcile context before any mutation. | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/coordinator.test.ts` |
| UW-21 | Attachment selection/upload/discard preserves accurate state, requests reselection when necessary, and neve… | **GAP** |
| UW-22 | Keyboard/screen reader, long translations, 360/768/desktop layouts and software keyboard: every choice acce… | `tests/e2e/modules/unsaved-work.spec.ts` |
| UW-23 | Registry cleanup, repeated mounts, cancelled departure tokens and later edits: no stale prompt, leaked hand… | `tests/e2e/modules/unsaved-work.spec.ts`<br>`tests/unit/unsaved/coordinator.test.ts` |
| UW-24 | Coverage manifest: every existing editable surface has integration evidence or a documented read-only/non-d… | **GAP** |

## AUD-04 Mobile workflows

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| MW-01 | Every manifest surface fits required widths; no ordinary body overflow. Deliberate 2D regions scroll locall… | `tests/e2e/responsive/aud04-lists.spec.ts`<br>`tests/e2e/responsive/aud04-modules-a.spec.ts`<br>`tests/e2e/responsive/aud04-modules-b.spec.ts`<br>`tests/e2e/responsive/aud04-primitives.spec.ts`<br>`tests/e2e/responsive/geometry.ts` |
| MW-02 | Navigation opens/closes, scrolls, identifies active module and reaches all authorized destinations; 44px co… | `tests/e2e/responsive/aud04-modules-b.spec.ts`<br>`tests/e2e/responsive/aud04-shell.spec.ts` |
| MW-03 | Workspace switch works at phone/tablet sizes with correct identity, route fallback and AUD-03 Stay/Discard/… | `tests/e2e/responsive/aud04-shell.spec.ts` |
| MW-04 | Record Back preserves list filters/sort/page; deep-link fallback is logical; browser traversal does not sil… | **GAP** |
| MW-05 | Operational cards and comparison tables expose required identity, status, exact amounts and all permitted r… | `tests/e2e/responsive/aud04-lists.spec.ts`<br>`tests/e2e/responsive/aud04-modules-a.spec.ts`<br>`tests/e2e/responsive/aud04-modules-b.spec.ts`<br>`tests/unit/tables/aud04-column-width.test.ts`<br>`tests/unit/tables/aud04-data-table.test.ts` |
| MW-06 | Search/filter Apply/Cancel/Clear, sort, pagination and no-results states work with long labels and keyboard… | `tests/e2e/responsive/aud04-lists.spec.ts`<br>`tests/e2e/responsive/aud04-modules-a.spec.ts`<br>`tests/e2e/responsive/aud04-modules-b.spec.ts`<br>`tests/unit/tables/aud04-column-width.test.ts`<br>`tests/unit/tables/aud04-data-table.test.ts`<br>+1 more |
| MW-07 | Existing bulk selection/export shows correct scope, cannot act on stale selections and produces the authori… | **GAP** |
| MW-08 | Long form and line-item entry complete on 360px phone; required fields/errors are visible; primary action r… | `tests/e2e/responsive/aud04-expenses.spec.ts`<br>`tests/e2e/responsive/aud04-modules-a.spec.ts` |
| MW-09 | Date/decimal inputs preserve existing interpretation; unsupported/ambiguous values produce actionable error… | `tests/e2e/responsive/aud04-expenses.spec.ts`<br>`tests/e2e/responsive/aud04-modules-a.spec.ts` |
| MW-10 | Dialogs, nested pickers and confirmations fit short landscape; focus/close/scroll work and dirty-state warn… | `tests/e2e/responsive/aud04-primitives.spec.ts`<br>`tests/e2e/responsive/geometry.ts` |
| MW-11 | Task journey persists permitted updates/transitions and recovers from stale concurrent change without overw… | `tests/e2e/responsive/aud04-tasks.spec.ts` |
| MW-12 | Approval journey previews evidence, approves/rejects correctly and safely handles a second user's prior dec… | `tests/e2e/responsive/approvals-mobile.spec.ts` |
| MW-13 | Expense creation/edit and existing submission/approval persist correct amounts/status/receipt; permissions… | `tests/e2e/responsive/aud04-expenses.spec.ts` |
| MW-14 | Site log sections and evidence persist through save/submit/reopen; failed upload is visible and recoverable. | `tests/e2e/responsive/daily-logs-mobile.spec.ts` |
| MW-15 | Slow response, double tap, validation error, server failure and unknown outcome never produce false success… | `tests/e2e/responsive/approvals-mobile.spec.ts`<br>`tests/e2e/responsive/aud04-expenses.spec.ts`<br>`tests/e2e/responsive/aud04-tasks.spec.ts`<br>`tests/e2e/responsive/daily-logs-mobile.spec.ts` |
| MW-16 | Rotation/resizing and mobile/desktop breakpoint crossing preserve form input, record, filters and selection… | `tests/e2e/responsive/approvals-mobile.spec.ts`<br>`tests/e2e/responsive/aud04-lists.spec.ts`<br>`tests/e2e/responsive/aud04-modules-b.spec.ts`<br>`tests/e2e/responsive/aud04-tasks.spec.ts`<br>`tests/e2e/responsive/daily-logs-mobile.spec.ts`<br>+1 more |
| MW-17 | Charts expose tap/focus values and textual alternatives; document/calendar/3D controls remain usable or sho… | `tests/e2e/responsive/aud04-modules-a.spec.ts`<br>`tests/e2e/responsive/aud04-modules-b.spec.ts` |
| MW-18 | Real-device Photos/Files/camera selection, cancellation, unsupported file and upload failure behave correct… | `tests/e2e/responsive/daily-logs-mobile.spec.ts` |
| MW-19 | Keyboard/screen-reader checks, 200% text zoom, 320px reflow and reduced motion pass; touch areas meet the 4… | `tests/e2e/responsive/aud04-modules-a.spec.ts`<br>`tests/e2e/responsive/aud04-modules-b.spec.ts`<br>`tests/e2e/responsive/aud04-primitives.spec.ts`<br>`tests/e2e/responsive/aud04-shell.spec.ts`<br>`tests/e2e/responsive/aud04-tasks.spec.ts`<br>+1 more |
| MW-20 | Company/Group/Project-restricted and read-only identities see only authorized records/actions across respon… | **GAP** |
| MW-21 | Desktop regression snapshots and core workflows pass; shared fixes do not shrink desktop usability or break… | `tests/e2e/responsive/aud04-lists.spec.ts`<br>`tests/e2e/responsive/aud04-primitives.spec.ts`<br>`tests/e2e/responsive/aud04-shell.spec.ts` |
| MW-22 | Performance comparison, real-device evidence and complete module manifest are attached; no missing result i… | **GAP** |

## AUD-05 Navigation and first-time UX

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| UX-01 | Navigation inventory covers every enabled module, role and context with no unclassified route or action. | **GAP** |
| UX-02 | One resolver produces desktop/mobile groups; hidden/disabled modules and empty groups never appear, while a… | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/unit/ux/aud05-navigation.test.ts` |
| UX-03 | Direct list/detail links show correct header, active module/section, workspace and breadcrumb; all clickabl… | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/unit/ux/aud05-navigation.test.ts` |
| UX-04 | Filtered list → record → return retains query/page; direct deep link gets correct fallback. | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/unit/ux/aud05-navigation.test.ts` |
| UX-05 | Workspace switch preserves/falls back route with truthful explanation; denied record never leaks details. | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/e2e/ux/aud05-states.spec.ts` |
| UX-06 | Full demo impersonation resets identity, role, memberships, dashboard, nav, help preferences and company co… | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/e2e/ux/aud05-states.spec.ts`<br>`tests/unit/ux/aud05-states.test.ts` |
| UX-07 | Common nouns/actions match glossary across menu, page, Quick Create, empty states and feedback; exceptions… | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/unit/ux/aud05-glossary.test.ts` |
| UX-08 | Primary action is obvious and authorized; blocked state explains why; secondary/destructive actions are cle… | `tests/e2e/ux/aud05-states.spec.ts` |
| UX-09 | Quick Create finds allowed action, resolves required context and reaches the canonical working form; unavai… | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/unit/ux/aud05-navigation.test.ts` |
| UX-10 | Search/filters/sort show scope, current state and result count; URL round-trip and reset work; no inaccessi… | `tests/e2e/ux/aud05-states.spec.ts`<br>`tests/unit/ux/aud05-states.test.ts` |
| UX-11 | First-run empty, no-results, loading, error and saved states have truthful distinct messages and useful per… | `tests/e2e/ux/aud05-states.spec.ts`<br>`tests/unit/ux/aud05-states.test.ts` |
| UX-12 | Network/read failure shows Retry; failed save retains draft per AUD-03; unknown write outcome never shows f… | `tests/e2e/ux/aud05-states.spec.ts`<br>`tests/unit/ux/aud05-states.test.ts` |
| UX-13 | Task assignment/status, approval decision, invoice/expense and project navigation journeys are understandab… | `tests/e2e/ux/aud05-states.spec.ts` |
| UX-14 | Populated demo dashboards show live authorized records/counts, no fake placeholder content, and link to the… | `tests/e2e/ux/aud05-navigation.spec.ts` |
| UX-15 | A new viewer receives no creator-only guidance; a new creator can dismiss contextual help without losing th… | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/e2e/ux/aud05-states.spec.ts`<br>`tests/unit/ux/aud05-help-start-here.test.ts`<br>`tests/unit/ux/aud05-states.test.ts` |
| UX-16 | Module Help reflects actual terms/actions and is accessible by keyboard and touch; no forced tours or repea… | `tests/e2e/ux/aud05-navigation.spec.ts`<br>`tests/e2e/ux/aud05-states.spec.ts`<br>`tests/unit/ux/aud05-help-start-here.test.ts`<br>`tests/unit/ux/aud05-navigation.test.ts`<br>`tests/unit/ux/aud05-states.test.ts` |
| UX-17 | Keyboard focus, screen reader landmarks/announcements, 200% text zoom and long labels remain usable on desk… | `tests/e2e/ux/aud05-states.spec.ts` |
| UX-18 | Existing navigation pending/loading performance and authorized query counts show no material regression; gu… | `tests/e2e/ux/aud05-navigation.spec.ts` |
| UX-19 | User study: at least two first-time participants per representative role family attempt the assigned journe… | **GAP** |
| UX-20 | Existing role/navigation, mobile, AUD-01/02/03 and shell regression tests pass; no feature is merely hidden… | **GAP** |

## AUD-06 Demo roles and permissions

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| RP-01 | Curated and non-curated seeded accounts, ARMAAR heads and project manager match asserted active memberships… | `tests/security/access-manifest.test.ts` |
| RP-02 | Owner → Finance/Architecture/PM demo switch produces different person/session/context; old session rejected… | `tests/e2e/auth/aud06-roles.spec.ts` |
| RP-03 | Self-switch does nothing; ineligible/unknown target is refused before old session termination; failed sign-… | `tests/integration/auth/demo-user-switch.test.ts` |
| RP-04 | Switch action hidden and server-refused in staging/production; explicit hosted-demo mode never overrides pr… | `scripts/verify-production-guards.ts`<br>`tests/e2e/auth/aud06-roles.spec.ts`<br>`tests/unit/auth/dev-mode.test.ts` |
| RP-05 | Identity switch clears old dashboard, workspace, filters, caches, notifications, recent work and private dr… | `tests/e2e/auth/aud06-roles.spec.ts` |
| RP-06 | Company switch retains identity/session while updating only authorized workspace; rejected/ambiguous switch… | `tests/api/workspace/company-switch-identity.test.ts` |
| RP-07 | Group list/count/search/export equals the union of action-authorized Company results, with no double count… | **GAP** |
| RP-08 | Project-scoped PM sees permitted project/records but not another project in same Company; direct URL/API/at… | `tests/e2e/auth/aud06-roles.spec.ts` |
| RP-09 | Viewer/self-service can read only permitted records and cannot forge create/edit/approve/archive via action… | `tests/api/meetings/aud10-meeting-task.test.ts`<br>`tests/security/harness/mutations.ts`<br>`tests/security/same-company-roles.test.ts` |
| RP-10 | Each existing module's list, detail, actions, search, filter options and exports obey the same scoped predi… | **GAP** |
| RP-11 | Finance/HR/legal/private file and salary/compensation views deny restricted fields; aggregate/report endpoi… | `tests/security/private-fields.test.ts` |
| RP-12 | Approval and linked workflows require both record visibility and action grant; a source/attachment link nev… | `tests/security/private-fields.test.ts`<br>`tests/security/same-company-roles.test.ts` |
| RP-13 | Platform Admin 3D/admin configuration is inaccessible to tenant actors even by direct requests; tenant view… | `tests/e2e/auth/aud06-roles.spec.ts`<br>`tests/security/harness/platform-session.ts`<br>`tests/security/platform-boundary.test.ts` |
| RP-14 | Forged company/project/client/Unit/assignee IDs and stale pagination cursor cannot force a cross-scope read… | `tests/security/cursor-and-forgery.test.ts` |
| RP-15 | Removing a role, membership/project grant or module entitlement takes effect for already-open sessions and… | `tests/security/revocation.test.ts` |
| RP-16 | Revocation racing a mutation has serially consistent outcome; no success audit event/notification for a rej… | `tests/security/revocation.test.ts` |
| RP-17 | Empty but authorized results differ from denied module and missing record; 401/403/404 are controlled, with… | `tests/security/harness/mutations.ts`<br>`tests/security/same-company-roles.test.ts` |
| RP-18 | Notifications, search, recent work, favorites, activity and document download/previews do not reveal an ina… | `tests/api/notifications/notification-withdrawn.test.ts` |
| RP-19 | Dashboard selected for Group Owner is Owner, not QA/QC; each representative identity's focus and links matc… | `tests/api/dashboard/dashboard-identity.test.ts`<br>`tests/e2e/auth/aud06-roles.spec.ts` |
| RP-20 | Department head's company-specific delegation does not create Group-wide permission where absent; Company A… | **GAP** |
| RP-21 | Multi-company actor may access precisely granted companies/projects and sees exact employing/legal entity i… | `tests/security/access-manifest.test.ts` |
| RP-22 | Scoped query/export performance shows no N+1 regression and caches do not serve another user's/company's re… | **GAP** |
| RP-23 | Accessible mobile and desktop states show the same authorized actions; hidden button alone does not constit… | `tests/e2e/auth/aud06-roles.spec.ts`<br>`tests/security/harness/mutations.ts`<br>`tests/security/same-company-roles.test.ts` |
| RP-24 | Full entry-point matrix has ownership, positive/negative tests and evidence; no unclassified sensitive endp… | `tests/security/access-manifest.test.ts` |

## AUD-07 Performance and stability

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| PS-01 | Route manifest, deterministic D1/D10 counts, production build and reproducible environment/profile metadata… | `tests/api/perf/aud07-fixture.ts`<br>`tests/e2e/perf/aud07-baseline.spec.ts`<br>`tests/e2e/perf/aud07-manifest.ts` |
| PS-02 | Cold/warm/uncached samples are separate; data-ready assertions reject heading-only, fake-empty and skeleton… | `tests/e2e/perf/aud07-manifest.ts` |
| PS-03 | Raw attempts, failures, median/p95 and sample count retained; budgets evaluated without dropping timeouts. | **GAP** |
| PS-04 | Request-correlated SQL counts/durations replace transaction-commit proxy as exact evidence; Group work sepa… | `tests/e2e/perf/aud07-baseline.spec.ts`<br>`tests/e2e/perf/navigation-query-count.spec.ts`<br>`tests/unit/observability/statement-counter.test.ts` |
| PS-05 | Rows 10→50 do not trigger per-row query growth; D10 stays bounded; filtered totals/order/pages remain correct. | `tests/api/perf/aud07-fixture.ts`<br>`tests/api/perf/aud07-list-query-growth.test.ts` |
| PS-06 | Company/Group API and navigation budgets pass with authorized demo identities; separate preview/export meas… | `tests/e2e/perf/aud07-baseline.spec.ts` |
| PS-07 | Twenty-user ten-minute workload validates successful response content, expected denials and persisted mutat… | **GAP** |
| PS-08 | Query/index improvements include plan evidence and safe migration/deployment/rollback checks. | **GAP** |
| PS-09 | 1.5s optional-slot delay adds ≤100ms to median primary readiness; optional failure is contained. | **GAP** |
| PS-10 | Obsolete read responses never overwrite latest filters/context; rapid navigation causes no stuck loaders or… | `tests/e2e/perf/aud07-recovery.spec.ts`<br>`tests/unit/client/aud07-api-request.test.ts` |
| PS-11 | Prefetch requests/payload and bundle breakdown show no blanket prefetch or unnecessary heavy authoring assets. | **GAP** |
| PS-12 | Cache isolation, write invalidation and permission revocation pass AUD-06 cross-user/company tests. | **GAP** |
| PS-13 | Read timeout/500/rate-limit injection yields bounded retries, accurate message and working manual recovery. | `tests/e2e/perf/aud07-recovery.spec.ts`<br>`tests/unit/client/aud07-api-request.test.ts` |
| PS-14 | Validation/access/conflict responses are not retried; inputs and AUD-02/03 conflict recovery remain intact. | `tests/e2e/perf/aud07-recovery.spec.ts`<br>`tests/unit/client/aud07-api-request.test.ts` |
| PS-15 | Lost mutation response and duplicate click cannot produce false success/false rollback or unsafe automatic… | `tests/e2e/perf/aud07-recovery.spec.ts`<br>`tests/unit/client/aud07-api-request.test.ts` |
| PS-16 | Commit succeeds then refresh fails: Retry reads data without creating a second business operation. | `tests/e2e/perf/aud07-recovery.spec.ts`<br>`tests/unit/client/aud07-api-request.test.ts` |
| PS-17 | Database contention/pool pressure fails in a bounded controlled way; no indefinite transaction or broken at… | `tests/api/jobs/aud07-contention.test.ts` |
| PS-18 | Worker crash/restart, transient failure and poison job preserve durable work, bounded retries and deduplica… | `tests/api/jobs/aud07-worker-stability.test.ts` |
| PS-19 | Repeated navigation/dialog open-close cycles show no growing listener/request leak; large tables/uploads st… | `tests/e2e/perf/aud07-recovery.spec.ts` |
| PS-20 | Chromium benchmark plus Firefox/WebKit and real-phone functional recovery evidence attached; desktop/mobile… | **GAP** |
| PS-21 | Telemetry/runbook is useful and redacted; no private SQL bindings, tokens, record names or unprotected inte… | `tests/unit/observability/statement-counter.test.ts` |
| PS-22 | Before/after report includes all targets, non-target regression checks, fixture revision, artifacts and exp… | **GAP** |

## AUD-08 Data tables and exports

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| DT-01 | Manifest covers all existing lists/custom tables, capabilities, limits and query/export owners; absent oper… | `tests/api/hse/aud08-hse-lists.test.ts`<br>`tests/api/qaqc/aud08-qaqc-lists.test.ts`<br>`tests/unit/tables/list-manifest.test.ts` |
| DT-02 | Page/API/export share normalized section and filter semantics; Mine/Archived/Open restrictions do not disap… | `tests/api/announcements/aud08-announcement-feed.test.ts`<br>`tests/api/clients/aud08-client-list.test.ts`<br>`tests/api/contracts/aud08-contract-lists.test.ts`<br>`tests/api/daily-logs/aud08-daily-log-lists.test.ts`<br>`tests/api/documents/aud08-document-list.test.ts`<br>+12 more |
| DT-03 | Multi-filter/search/date combinations return independently expected records and count before pagination; ma… | `tests/api/activity/aud08-activity-dates.test.ts`<br>`tests/api/announcements/aud08-announcement-feed.test.ts`<br>`tests/api/clients/aud08-client-list.test.ts`<br>`tests/api/contracts/aud08-contract-lists.test.ts`<br>`tests/api/daily-logs/aud08-daily-log-lists.test.ts`<br>+12 more |
| DT-04 | Numeric/date/status sorting, null order and unique tie-breaker match across all pages/API/export, including… | `tests/api/announcements/aud08-announcement-feed.test.ts`<br>`tests/api/calendar/aud08-calendar-bounds.test.ts`<br>`tests/api/clients/aud08-client-list.test.ts`<br>`tests/api/contracts/aud08-contract-lists.test.ts`<br>`tests/api/daily-logs/aud08-daily-log-lists.test.ts`<br>+14 more |
| DT-05 | Page-size/filter/sort changes reset correctly; URL/back/refresh round-trip; zero/one-page counts and last-p… | `tests/api/announcements/aud08-announcement-feed.test.ts`<br>`tests/api/approvals/aud08-center-window.test.ts`<br>`tests/api/calendar/aud08-calendar-bounds.test.ts`<br>`tests/api/clients/aud08-client-list.test.ts`<br>`tests/api/contracts/aud08-contract-lists.test.ts`<br>+19 more |
| DT-06 | Rows/counts in one response are consistent under concurrent changes; cross-request live-view limitations ar… | `tests/api/engineering/aud08-registers.test.ts`<br>`tests/api/finance/aud08-finance-lists.test.ts`<br>`tests/api/hse/aud08-hse-lists.test.ts`<br>`tests/api/meetings/aud08-meeting-lists.test.ts`<br>`tests/api/qaqc/aud08-qaqc-lists.test.ts`<br>+1 more |
| DT-07 | Page versus filtered totals are labeled; mixed currencies are not summed without policy; AUD-01 finance fix… | `tests/api/finance/aud08-finance-lists.test.ts` |
| DT-08 | Columns hide/reset/save locally per identity/workspace/list; mandatory columns remain; corrupt/blocked stor… | `tests/api/tables/aud08-shared.test.ts`<br>`tests/e2e/tables/aud08-business.spec.ts`<br>`tests/e2e/tables/aud08-shared.spec.ts`<br>`tests/unit/tables/aud04-column-width.test.ts`<br>`tests/unit/tables/preferences.test.ts` |
| DT-09 | Removed/unauthorized stored columns cannot reveal private DTO/export fields; explicit URL size overrides pr… | `tests/api/team/aud08-team-lists.test.ts`<br>`tests/e2e/tables/aud08-shared.spec.ts`<br>`tests/unit/tables/preferences.test.ts` |
| DT-10 | Page select-all, indeterminate state/count and clear-on-query/page/context change are correct; mobile resiz… | **GAP** |
| DT-11 | Existing all-matching mode has explicit scope/snapshot token and current authorization; forged/stale tokens… | **GAP** |
| DT-12 | Bulk permission/state/version refusal, atomic rollback or documented partial result is accurate; no silent… | **GAP** |
| DT-13 | Repeated bulk click and lost response cause no unsafe replay; audit and side effects reflect actual committ… | **GAP** |
| DT-14 | All-matching export includes every expected row beyond one page in correct order; selected/current-page mod… | `tests/api/exports/aud08-exports.test.ts`<br>`tests/e2e/tables/aud08-exports.spec.ts` |
| DT-15 | Standard versus visible columns explicit; field redaction, Company/Project IDs, decimals, currencies and da… | `tests/api/exports/aud08-exports.test.ts`<br>`tests/unit/csv/aud08-csv.test.ts` |
| DT-16 | Concurrent export updates produce a consistent snapshot; async generation/download rechecks access and iden… | `tests/api/exports/aud08-exports.test.ts` |
| DT-17 | Row/byte/time limits refuse clearly with no silent truncation or success-formatted error file; bounded memo… | `tests/api/exports/aud08-exports.test.ts`<br>`tests/e2e/tables/aud08-exports.spec.ts`<br>`tests/unit/csv/aud08-csv.test.ts` |
| DT-18 | CSV adversarial formula prefixes, control characters, quotes, multiline text, Unicode, negative numbers and… | `tests/unit/csv/aud08-csv.test.ts`<br>`tests/unit/utils/csv.test.ts` |
| DT-19 | Keyboard/screen-reader selection/sort and mobile local-scroll/action bars work; row menus never accidentall… | `tests/api/tables/aud08-shared.test.ts`<br>`tests/e2e/tables/aud08-business.spec.ts`<br>`tests/e2e/tables/aud08-operations.spec.ts`<br>`tests/e2e/tables/aud08-shared.spec.ts` |
| DT-20 | Loading/no-results/error states and stale-response prevention preserve correct query; existing inline-edit… | `tests/e2e/tables/aud08-operations.spec.ts` |
| DT-21 | Large data and Group scopes meet AUD-07 budgets without N+1 growth; export measured separately. | **GAP** |
| DT-22 | Direct API/export/bulk attacks with foreign Company/Project/record IDs fail; authorized positive-control ac… | `tests/api/announcements/aud08-announcement-feed.test.ts`<br>`tests/api/clients/aud08-client-list.test.ts`<br>`tests/api/contracts/aud08-contract-lists.test.ts`<br>`tests/api/daily-logs/aud08-daily-log-lists.test.ts`<br>`tests/api/documents/aud08-document-list.test.ts`<br>+14 more |

## AUD-09 Forms and validation

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| FV-01 | Manifest includes every existing business form/custom adapter, its schema, serialization and conditional ru… | `tests/unit/forms/form-manifest.test.ts` |
| FV-02 | Labels/required hints, unique instance IDs and error associations work with page plus nested dialog and rep… | `tests/e2e/forms/aud09-a11y.spec.ts`<br>`tests/e2e/forms/aud09-operations.spec.ts`<br>`tests/e2e/forms/aud09-people.spec.ts`<br>`tests/e2e/forms/aud09-shared.spec.ts` |
| FV-03 | Untouched form has no error wall; blur and submit validation timing consistent; invalid submission focuses… | `tests/e2e/forms/aud09-a11y.spec.ts`<br>`tests/e2e/forms/aud09-operations.spec.ts`<br>`tests/e2e/forms/aud09-people.spec.ts`<br>`tests/e2e/forms/aud09-shared.spec.ts`<br>`tests/unit/forms/field-config.test.ts` |
| FV-04 | Client/action/API agree on required, length, enum, range and cross-field rules; server rejects forged inval… | `tests/api/clients/aud09-client-forms.test.ts`<br>`tests/api/daily-logs/aud09-daily-log-forms.test.ts`<br>`tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/forms/aud09-envelope.test.ts`<br>`tests/api/hr/aud09-hr-forms.test.ts`<br>+14 more |
| FV-05 | Empty/zero/false/null/omitted values round-trip correctly; update omissions cannot reset saved defaults or… | `tests/api/clients/aud09-client-forms.test.ts`<br>`tests/api/daily-logs/aud09-daily-log-forms.test.ts`<br>`tests/api/engineering/aud09-contractor-engineering-forms.test.ts`<br>`tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/hr/aud09-hr-forms.test.ts`<br>+20 more |
| FV-06 | Decimal, negative/zero, ambiguous locale input, overflow/NaN and quantity precision fixtures preserve domai… | `tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/inventory/aud09-inventory-forms.test.ts`<br>`tests/api/procurement/aud09-procurement-forms.test.ts`<br>`tests/api/project-structure/aud09-unit-forms.test.ts`<br>`tests/api/sales/aud09-sales-contracts-forms.test.ts`<br>+3 more |
| FV-07 | Date-only/timezone/boundary and invalid schedule inputs yield expected stored values or field errors. | `tests/api/daily-logs/aud09-daily-log-forms.test.ts`<br>`tests/api/engineering/aud09-contractor-engineering-forms.test.ts`<br>`tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/hr/aud09-hr-forms.test.ts`<br>`tests/api/hse/aud09-hse-forms.test.ts`<br>+9 more |
| FV-08 | Parent change preserves valid child values, clears invalid ones visibly and ignores stale async option resp… | `tests/api/inventory/aud09-inventory-forms.test.ts`<br>`tests/api/tasks/aud09-task-forms.test.ts`<br>`tests/e2e/forms/aud09-operations.spec.ts` |
| FV-09 | Options loading/error/empty/inactive states distinct; forged foreign project/client/Unit/assignee IDs refus… | `tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/inventory/aud09-inventory-forms.test.ts`<br>`tests/api/meetings/aud09-meeting-forms.test.ts`<br>`tests/api/procurement/aud09-procurement-forms.test.ts`<br>`tests/api/project-planning/aud09-planning-forms.test.ts`<br>+5 more |
| FV-10 | Hidden/conditional fields obey explicit omit/clear/reject behavior; permission changes never become acciden… | `tests/api/clients/aud09-client-forms.test.ts`<br>`tests/api/engineering/aud09-contractor-engineering-forms.test.ts`<br>`tests/api/hr/aud09-hr-forms.test.ts`<br>`tests/api/meetings/aud09-meeting-forms.test.ts`<br>`tests/api/organization/aud09-organization-forms.test.ts`<br>+7 more |
| FV-11 | Duplicate checks handle concurrent create; Client soft override remains explicit and cannot bypass hard con… | `tests/api/clients/aud09-client-forms.test.ts`<br>`tests/api/projects/aud09-project-forms.test.ts`<br>`tests/e2e/forms/aud09-operations.spec.ts` |
| FV-12 | Submit button/Enter/double-click/AUD-03 save share one path; no duplicate commit, and textarea/composition… | `tests/e2e/forms/aud09-a11y.spec.ts`<br>`tests/e2e/forms/aud09-operations.spec.ts`<br>`tests/e2e/forms/aud09-shared.spec.ts` |
| FV-13 | Validation/500/network/conflict cases preserve input and expose accurate errors; unknown outcome is not bli… | `tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/forms/aud09-envelope.test.ts`<br>`tests/api/tasks/aud09-task-forms.test.ts`<br>`tests/e2e/forms/aud09-operations.spec.ts`<br>`tests/e2e/forms/aud09-shared.spec.ts`<br>+2 more |
| FV-14 | Commit then failed refresh produces saved state and read retry, not a duplicate save; success navigation ex… | `tests/api/hse/aud09-hse-forms.test.ts`<br>`tests/e2e/forms/aud09-shared.spec.ts` |
| FV-15 | Existing wizard Back/Next/conditional step/final validation preserves values and brings hidden-step errors… | **GAP** |
| FV-16 | Line-item reorder/remove/add maintains error-to-row identity; totals and payload limits correct. | `tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/inventory/aud09-inventory-forms.test.ts`<br>`tests/api/procurement/aud09-procurement-forms.test.ts`<br>`tests/api/sales/aud09-sales-contracts-forms.test.ts`<br>`tests/e2e/forms/aud09-money.spec.ts`<br>+1 more |
| FV-17 | Existing Save draft follows relaxed draft policy; Submit enforces full policy; forms without drafts make no… | **GAP** |
| FV-18 | Upload validation/scan failure/cancel/retry preserve valid files without duplicate links or deleting canoni… | `tests/api/documents/aud09-uploads.test.ts`<br>`tests/e2e/forms/aud09-uploads.spec.ts` |
| FV-19 | Mobile file reselection and processing state honest; preview alone never counts as successful attachment. | `tests/api/documents/aud09-uploads.test.ts`<br>`tests/e2e/forms/aud09-uploads.spec.ts` |
| FV-20 | Session/identity/workspace changes protect private input and reject stale-context submission; AUD-02/03/06… | `tests/api/engineering/aud09-contractor-engineering-forms.test.ts`<br>`tests/api/hr/aud09-hr-forms.test.ts`<br>`tests/api/hse/aud09-hse-forms.test.ts` |
| FV-21 | Keyboard/screen-reader/200% text zoom and 360px phone/768px tablet checks pass; errors/actions reachable ab… | `tests/e2e/forms/aud09-a11y.spec.ts` |
| FV-22 | Every module/adapter has positive persisted-state evidence and applicable refusal tests; telemetry contains… | `tests/api/clients/aud09-client-forms.test.ts`<br>`tests/api/daily-logs/aud09-daily-log-forms.test.ts`<br>`tests/api/finance/aud09-finance-forms.test.ts`<br>`tests/api/meetings/aud09-meeting-forms.test.ts`<br>`tests/api/project-planning/aud09-planning-forms.test.ts`<br>+3 more |

## AUD-10 Cross-module workflows

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| CW-01 | Matrix covers every active approval provider, existing conversion/sync and record-link consumer with explic… | `tests/api/integration/workflow-matrix.test.ts` |
| CW-02 | Center approval and source-page approval invoke equivalent policy; source, queue, requester history and cou… | `tests/api/approvals/aud10-center-integrity.test.ts`<br>`tests/api/approvals/aud10-center-providers.test.ts`<br>`tests/api/approvals/aud10-cycles.ts`<br>`tests/api/approvals/aud10-scenarios.ts`<br>`tests/api/approvals/aud10-source-guard-finance.test.ts`<br>+4 more |
| CW-03 | Every existing approval provider passes one allowed decision and a forbidden/conflict case; unavailable pro… | `tests/api/approvals/aud10-center-integrity.test.ts`<br>`tests/api/approvals/aud10-center-providers.test.ts`<br>`tests/unit/approvals/group-approvals-view.test.ts` |
| CW-04 | Concurrent approve/reject yields one valid transition; intermediate/final stages and existing self-approval… | `tests/api/approvals/aud10-center-integrity.test.ts`<br>`tests/api/approvals/aud10-cycles.ts`<br>`tests/api/approvals/aud10-scenarios.ts`<br>`tests/api/approvals/aud10-source-guard-finance.test.ts`<br>`tests/api/approvals/aud10-source-guard-hr-units.test.ts`<br>+3 more |
| CW-05 | Reject/return/resubmit where supported retains history, identifies the correct new cycle and rejects old-cy… | `tests/api/approvals/aud10-cycles.ts`<br>`tests/api/approvals/aud10-scenarios.ts`<br>`tests/api/approvals/aud10-source-guard-finance.test.ts`<br>`tests/api/approvals/aud10-source-guard-hr-units.test.ts`<br>`tests/api/approvals/aud10-source-guard-procurement.test.ts`<br>+2 more |
| CW-06 | Inject failure after each approval write: whole synchronous invariant rolls back and no success event remains. | `tests/api/approvals/aud10-center-integrity.test.ts` |
| CW-07 | Two concurrent action→Task conversions create one canonical Task/link; authorized retry returns that same T… | `tests/api/meetings/aud10-meeting-task.test.ts`<br>`tests/api/meetings/meetings-service.test.ts`<br>`tests/api/tasks/aud10-support.ts` |
| CW-08 | Task TODO/IN_PROGRESS/BLOCKED/COMPLETED and reassignment/null owner propagate to the linked action exactly… | `tests/api/meetings/aud10-meeting-task.test.ts` |
| CW-09 | Task completion→reopen→completion produces accurate new history/events; same-operation replay produces none… | `tests/api/meetings/aud10-meeting-task.test.ts` |
| CW-10 | Cancelled action and task archive/restore respect explicit policy without resurrection or accidental owner… | `tests/api/meetings/aud10-meeting-task.test.ts` |
| CW-11 | Direct action edit cannot diverge task-owned fields; failed sync rolls back Task mutation under AUD-02. | `tests/api/meetings/aud10-meeting-task.test.ts` |
| CW-12 | Canonical Project/Client/Unit links from existing Sales/Finance/Architecture views resolve the same authori… | `tests/api/daily-logs/aud10-daily-log-task.test.ts`<br>`tests/api/project-planning/aud10-planning-task.test.ts`<br>`tests/api/tasks/aud10-task-from-record.test.ts` |
| CW-13 | Cross-company/project forged source/target IDs refused before writes; Group opening resolves concrete autho… | `tests/api/daily-logs/aud10-daily-log-task.test.ts`<br>`tests/api/meetings/aud10-meeting-task.test.ts`<br>`tests/api/project-planning/aud10-planning-task.test.ts`<br>`tests/api/tasks/aud10-support.ts`<br>`tests/api/tasks/aud10-task-from-record.test.ts` |
| CW-14 | Attach/preview/download/unlink uses canonical file and current access; unlink cannot delete another record'… | `tests/api/documents/aud10-shared-document.test.ts` |
| CW-15 | Comments/mentions/watchers/history cannot leak inaccessible parent/private file content, including access r… | `tests/integration/delivery/outbox-delivery.test.ts` |
| CW-16 | Crash after commit before dispatch preserves outbox work; worker retry/restart does not duplicate business… | `tests/integration/delivery/outbox-delivery.test.ts` |
| CW-17 | Duplicate/out-of-order events cannot regress latest projection/status; terminal failure is inspectable with… | `tests/integration/delivery/outbox-delivery.test.ts` |
| CW-18 | Lost response and failed post-commit refresh reconcile safely with truthful committed/pending/unknown feedb… | **GAP** |
| CW-19 | Source/target archive, missing record and revoked permission show safe link states and preserve historical… | `tests/api/collaboration/aud10-link-states.test.ts`<br>`tests/api/documents/aud10-shared-document.test.ts` |
| CW-20 | Current-tab refetch and other-tab refresh/focus converge to canonical state; affected source/target lists a… | **GAP** |
| CW-21 | Read-only verifier detects deliberately injected inconsistencies but excludes valid exceptions and changes… | `scripts/verify-workflow-consistency.ts`<br>`tests/integration/integrity/workflow-consistency.test.ts` |
| CW-22 | Representative phone and desktop journeys work across full demo-user switches; permissions and unsaved-work… | `tests/e2e/workflows/aud10-journeys.spec.ts` |
| CW-23 | Large Group/provider queues and linked-record summaries meet AUD-07 query budgets without per-row lookup gr… | `tests/api/approvals/aud10-center-query-budget.test.ts` |
| CW-24 | Full suite evidence includes positive controls, rollback/race assertions, event counts and owned-fixture cl… | **GAP** |

## AUD-11 Accessibility and visual consistency

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| AV-01 | Inventory covers each existing module's relevant list/detail/editor/overlay and distinguishes verified defe… | **GAP** |
| AV-02 | Skip link, landmarks, headings, page title and active navigation identify current authorized context. | `tests/e2e/a11y/aud11-shared.spec.ts` |
| AV-03 | Keyboard-only task edit, approval, expense and document interaction completes without hover/drag-only block… | `tests/e2e/a11y/aud11-modules.spec.ts` |
| AV-04 | Focus order/indicator is visible, unobscured and logical in both themes, including sticky UI and removed rows. | `tests/e2e/a11y/aud11-modules.spec.ts`<br>`tests/e2e/a11y/aud11-shared.spec.ts`<br>`tests/unit/a11y/aud11-modules.test.ts` |
| AV-05 | Dialog open/close, nested picker, Escape, background isolation and focus restoration work with AUD-03 Stay/… | `tests/e2e/a11y/aud11-shared.spec.ts` |
| AV-06 | Icon controls/links have correct contextual names; decorative icons and hidden responsive duplicates are no… | `tests/e2e/a11y/aud11-modules.spec.ts`<br>`tests/e2e/a11y/aud11-shared.spec.ts`<br>`tests/unit/a11y/announcer-and-names.test.ts`<br>`tests/unit/a11y/aud11-modules.test.ts` |
| AV-07 | Form labels, repeated-row IDs, required state and error summary/field focus work across page and dialog. | **GAP** |
| AV-08 | Table headers/sort/selection/filter/page states are understandable to keyboard and screen-reader users; mob… | `tests/e2e/a11y/aud11-modules.spec.ts` |
| AV-09 | Loading, result counts, confirmed save and failure are announced once without focus theft or false outcome. | `tests/e2e/a11y/aud11-shared.spec.ts`<br>`tests/unit/a11y/announcer-and-names.test.ts` |
| AV-10 | Measured text/control/status contrast meets project thresholds across light/dark and interactive states. | `tests/e2e/a11y/aud11-shared.spec.ts`<br>`tests/unit/a11y/contrast.test.ts` |
| AV-11 | 200% text enlargement, 320px reflow and 400% desktop zoom retain required content/actions with only justifi… | `tests/e2e/a11y/aud11-shared.spec.ts` |
| AV-12 | 44px touch targets, long translations and software-keyboard layouts pass without overlap or clipped errors/… | **GAP** |
| AV-13 | Shared spacing/type/button/status token inventory has no unexplained repeated divergence; desktop density r… | `tests/e2e/a11y/aud11-modules.spec.ts`<br>`tests/unit/a11y/aud11-modules.test.ts`<br>`tests/unit/a11y/theme-drift.test.ts` |
| AV-14 | Light/dark/system selection, first paint, portals and OS preference changes work without draft loss or them… | `tests/e2e/a11y/aud11-shared.spec.ts`<br>`tests/unit/a11y/theme-drift.test.ts` |
| AV-15 | Reduced motion and forced colors preserve loading/state feedback and essential controls/focus. | `tests/e2e/a11y/aud11-shared.spec.ts`<br>`tests/unit/a11y/theme-drift.test.ts` |
| AV-16 | Charts/viewers have authorized textual values or canonical business alternatives; external-file limitations… | `tests/e2e/a11y/aud11-modules.spec.ts` |
| AV-17 | Automated scans of normal/open/error states have no unresolved serious/critical findings and no unresolved… | `tests/e2e/a11y/aud11-modules.spec.ts`<br>`tests/e2e/a11y/aud11-shared.spec.ts` |
| AV-18 | Manual screen-reader/keyboard evidence and module regression suite complete; no unauthorized content introd… | **GAP** |

## AUD-12 Maintainability and developer experience

| ID | Requirement (abbreviated) | Tests naming it |
|---|---|---|
| DX-01 | Debt ledger prioritizes concrete observed problems and names owner, affected callers and invariant tests. | **GAP** |
| DX-02 | Existing ownership/state/import gates reject a deliberately introduced violation; no baseline expansion hid… | `tests/architecture/aud12-gate-injection.test.ts` |
| DX-03 | Shared extraction passes before/after characterization tests; module-specific policy and route/API compatib… | **GAP** |
| DX-04 | Server-only imports/secrets cannot enter client bundles; registries have complete handlers/routes and consi… | `scripts/check-client-bundle.ts`<br>`tests/architecture/aud12-client-bundle.test.ts` |
| DX-05 | API/action validation, error redaction, request IDs and explicit save outcomes pass adapter contract tests. | **GAP** |
| DX-06 | Clean checkout with pinned tooling completes documented setup and an actual persisted demo workflow. | **GAP** |
| DX-07 | Same application/shadow database is refused before schema tooling; approved separate shadow drift check lea… | `tests/integration/database/db-safety.test.ts`<br>`tests/unit/database/target.test.ts` |
| DX-08 | Reset/destructive scripts reject production/staging/unknown targets before execution; explicit disposable l… | `tests/integration/database/db-safety.test.ts`<br>`tests/unit/database/target.test.ts` |
| DX-09 | Migration replay and populated prior-version upgrade pass with preserved relations/totals and documented ro… | `tests/integration/aud12-migration-replay.test.ts` |
| DX-10 | Demo seed rerun follows documented idempotency and preserves unrelated data; ARMAAR verifiers pass without… | `tests/integration/aud12-seed-rerun.test.ts` |
| DX-11 | Build/deploy seed opt-in cannot seed production or an unapproved empty database; demo conveniences remain d… | `tests/integration/aud12-build-seed.test.ts`<br>`tests/integration/database/db-safety.test.ts`<br>`tests/unit/database/target.test.ts` |
| DX-12 | Parallel test jobs isolate fixtures/databases; cleanup errors are visible; race/time tests are deterministic. | **GAP** |
| DX-13 | CI failure injection proves required lint/type/domain/security/migration gates fail; shared-core changes tr… | `tests/architecture/aud12-gate-injection.test.ts` |
| DX-14 | Fork/untrusted PR jobs receive no privileged secrets; reports redact credentials/private data and have rete… | **GAP** |
| DX-15 | README/environment/command matrix matches implemented behavior; no unsupported claims of production guards… | **GAP** |
| DX-16 | Full regression evidence confirms no loss of finance accuracy, task concurrency, isolation, workflows, mobi… | **GAP** |

## Gap summary

| PRD | IDs with no citing test |
|---|---|
| AUD-01 Finance accuracy | none |
| AUD-02 Task reliability | none |
| AUD-03 Unsaved work | UW-21, UW-24 |
| AUD-04 Mobile workflows | MW-04, MW-07, MW-20, MW-22 |
| AUD-05 Navigation and first-time UX | UX-01, UX-19, UX-20 |
| AUD-06 Demo roles and permissions | RP-07, RP-10, RP-20, RP-22 |
| AUD-07 Performance and stability | PS-03, PS-07, PS-08, PS-09, PS-11, PS-12, PS-20, PS-22 |
| AUD-08 Data tables and exports | DT-10, DT-11, DT-12, DT-13, DT-21 |
| AUD-09 Forms and validation | FV-15, FV-17 |
| AUD-10 Cross-module workflows | CW-18, CW-20, CW-24 |
| AUD-11 Accessibility and visual consistency | AV-01, AV-07, AV-12, AV-18 |
| AUD-12 Maintainability and developer experience | DX-01, DX-03, DX-05, DX-06, DX-12, DX-14, DX-15, DX-16 |

DX-09 and DX-10 tests are opt-in (`AUD12_MIGRATION_REPLAY=1`, `AUD12_SEED_RERUN=1`) and run in CI's `release` job on push to `main`, not on pull requests. DX-04 also runs as `pnpm check:client-bundle` in the `static` job. Remaining AUD-12 gaps are expected to shrink as the AUD-12 tests land (`tests/architecture/aud12-*`, `tests/integration/aud12-*`, `scripts/check-*`); DX-01, DX-06, DX-14 and DX-15 are evidenced by documents and CI configuration (`docs/debt-ledger.md`, `docs/dev/local-setup.md`, `.github/workflows/ci.yml`, `docs/dev/*`) rather than by tests, and DX-16 is the combined regression run, which has not been done.
