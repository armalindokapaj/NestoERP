# ADR 0011 — Workspace Context: one switcher between the group and a company

- **Status:** Accepted
- **Date:** 2026-09-21
- **Affected PRDs:** NESTO V0.1 Workspace Context & Multi-Company Dashboard
  Switching (§-numbers below are its); PRD #6 (sessions and the context
  resolver); E-06 §19, §48 (the group, its companies, the access model);
  E-05A §26, §30, §34 (the Projects portfolio and the open-in-company hop);
  E-01 §103, §144-§147 (the group's
  people directory); C-01 ([ADR 0010](0010-c01-demo-user-switch.md): switching
  a *user* is a sign-out and a sign-in, and stays that way)

## Context

A session worked in exactly one company. A person who belongs to several — an
Owner, a group Finance head — could reach the others only by moving the session
to another membership, through a company switcher that answered "which company
am I in?" and nothing else. There was no way to ask "how is the group doing?",
and each feature that wanted a group answer grew its own fan-out: the D-01
executive dashboard, the Projects portfolio, the people directory and the HR
employment report each did it differently.

The PRD asks for one workspace: the group, or one company, chosen once and
obeyed by the dashboard, the sidebar, every module list, search and activity.

## Decisions

1. **The workspace is runtime state on the session, not a new organization
   model.** `Session.workspaceScope` is `GROUP | COMPANY`, nullable, and the
   group and its companies stay `ParentGroup` and `Company` (§48, §107, §108).
   `NULL` means "not chosen yet": the resolver picks the default, so no
   migration has to guess one for sessions that already exist. The anchor
   membership and `currentCompanyId` stay set in both workspaces — in `GROUP`
   they are the home company that keeps a `UserContext` valid.
   No cookie: the resolver reads nothing the browser can write (§14).
2. **Group standing is derived, never a role name — and it is not the only way
   in.** Any module except `people` held with `DataScope.GROUP` and access above
   `NONE`, in any usable membership, is group standing (`hasGroupStanding`). It
   falls out of the existing E-06 model — an Owner's organization `M/G`, a
   head's `A/G` through `POSITION_ORGANIZATION`, a `GROUP` grant — so no role
   key is hard-coded (§63). `people` is excluded because it is `C/G` for every
   role, which would make everybody a group person.

   Working in **more than one company** of the group also opens the Group
   workspace (`mayEnterGroupWorkspace`). It grants nothing: the union is of the
   companies they already belong to, read with each company's own rules. It is
   what keeps E-05A's cross-company Projects page working for somebody whose
   work is split between two companies. §7 and §91 refuse a *company-only*
   employee, and one company is exactly what they have, so they are never
   offered it.

   The two rules differ in where a sign-in **starts** (§16): group standing
   starts in the group, everybody else in their own company, including somebody
   who may enter the group only because they work in two.
3. **A group answer is the union of each company's own answer.** The Group
   workspace never removes the company boundary from a query. It resolves the
   person's real `UserContext` in each company they may use and asks that
   company's own scope builders, then unions before search, filter, sort and
   pagination: `{ OR: contexts.map(buildXScopeWhere) }`. One helper owns the
   question — `resolveWorkspaceContexts(session, { module, permission })` — and
   it is the only source of the ids behind `WHERE companyId IN (...)` (§57,
   §58). A module held in A and B but not C aggregates A and B and never C, and
   Group never upgrades a company permission (§60, §62, §92).
4. **Every module is classified, and a test fails when a new one is not.**
   `MODULE_GROUP_SUPPORT` in `config/workspace.ts` is `AGGREGATED`,
   `AGNOSTIC` or `COMPANY_ONLY`. `GROUP_ROUTES` then names the *routes* of an
   aggregated module that actually have a group answer — its lists. A record's
   own page, a form and any section nobody aggregated belong to one company and
   answer "choose a company" (§25, §29, §39, §85).
5. **The Group workspace reads; a write names a company.** A non-GET request
   for company data in the Group workspace is refused with **409
   `WORKSPACE_COMPANY_REQUIRED`** ("Choose a company to do this."), not 403:
   nothing is wrong with the person or the request, only with where it was
   made, and choosing a company is the fix. `withContext(handler, { group })`
   is default-deny — a route says `"read"` to answer GET in the group, `"any"`
   to handle both itself (§59).
6. **Opening another company's record switches the workspace to that company.**
   E-05A's open-in-company hop is generalised: from a group list, the row's
   link goes through the hop, which moves the session and then opens the record,
   so a group header never sits over one company's data.

   This is a **deviation from §31**, which asks that opening a project preserve
   the active workspace and show a `Group → Company A → Project` breadcrumb.
   Preserving it would leave the page readable but not writable: every write
   would have to derive its company from the record rather than the session, or
   be refused by §59. One coherent rule — you work where your workspace is —
   was preferred over a page whose reads and writes disagree. §31's second half
   is honoured: the cross-company link resolves by switching context safely, and
   it is the one consistent implementation it asks for. The breadcrumb still
   names the group and the company.
7. **A company that may not be entered and one that does not exist get the same
   answer.** `switchWorkspace` returns 403 for both. This is a **deviation from
   §81**, which asks for 404 on a company that does not exist: a 404 that
   differs from a 403 tells an attacker which company ids are real. A membership
   that exists but is not usable right now is the one case that says so
   (`MEMBERSHIP_INACTIVE`, `COMPANY_INACTIVE`), because the person already knows
   that company (§51, §89, §90).
8. **`companyId` in a request is a filter, never an authority.** A group list
   may be narrowed to one company, and the id is intersected with the companies
   already resolved for that person and action; one they may not read narrows
   nothing and says nothing about why. A company workspace ignores it (§86,
   §87). The three schemas that accept one are registered in
   `SCHEMA_FIELD_EXCEPTIONS` with that reasoning.
9. **The switch is a full page load.** There is no client cache library to
   invalidate, so the switcher posts to `/api/workspace`, shows a switching
   overlay, dispatches the `WORKSPACE_CHANGED` window event and reloads. The
   same event is written into `AuthEvent.metadata` on the
   `COMPANY_CONTEXT_SWITCHED` record, so the audit trail carries it (§67, §93).
   No workspace in the URL: a link that carried one would be a company id the
   browser chose (§14).
10. **Switching a workspace never changes who you are.** The user, the person
    and the session identity are untouched — only where they work. Switching a
    *demo user* remains C-01's sign-out and sign-in (§11).
11. **Losing group standing downgrades the session in place.** When a session
    says `GROUP` and the person no longer has standing, the resolver stores
    `COMPANY` and returns the company context, rather than failing the request
    (§82).
12. **The old company switcher is gone.** Deleted: `/api/me/company-context`,
    `/api/me/companies`, `components/layout/company-switcher.tsx` and
    `lib/modules/organization/company-context.service.ts`. One switcher
    replaces them, and no module implements a company switch of its own (§39).

## Consequences

- E-05A's cross-company create is superseded. `creatableCompanies` follows the
  workspace, so a CEO of two companies working in A is offered A alone and
  cannot create in B by naming it in the body; they switch to B first. The rule
  is now "you work where your workspace is", with no exception for create.
- The people directory keeps E-01's promise that everybody who works in the
  group can find everybody else. The workspace is its *default* scope, not a
  wall (§85, §86): a company workspace opens on that company's people and the
  company filter widens back to the group (`ALL_COMPANIES`). Every other
  aggregated module is a hard boundary — only this one directory was group-wide
  for everyone before the workspace existed.
- The group's companies are resolved once per request and memoised on the
  context. Within a request that is a feature — every list agrees on the same
  set — but a membership created mid-request is read by the next one.
- Group-wide providers (the people directory) must be asked with the *session's*
  workspace, not one company's context, or they narrow to that company. Global
  search hands them that company's permissions with the session's workspace.
- `nesto_erp` needs `prisma migrate deploy` for `20260920190000_workspace_scope`
  before a dev server can run against it: the generated client expects the
  column.
- Sessions that existed before the migration have `workspaceScope NULL` and get
  their default on the next request — Group for a group-level person, their
  employing company for everyone else (§16).
