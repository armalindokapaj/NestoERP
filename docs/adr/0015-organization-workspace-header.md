# ADR 0015: The organization workspace header in the sidebar

**Status:** accepted, 24 September 2026
**Context:** Sidebar Organization Workspace Header & Group Companies Popup PRD
("OW" below, §-numbers are its own), after Workspace Context
([ADR 0011](0011-workspace-context.md)) and NAV-01 to NAV-03
([ADR 0012](0012-nav-01-immediate-navigation-response.md),
[0013](0013-nav-02-faster-server-loading.md),
[0014](0014-nav-03-further-navigation-optimization.md)).

## Context

The tenant shell led with the NESTO wordmark. The workspace (the group, or one
company) was chosen from a control in the top bar with a chevron, beside a
"Demo data" chip. The PRD makes the customer organization the shell's identity:
the top of the sidebar names the organization and the workspace, and pressing
it switches the workspace. There is no arrow of any kind. The top bar keeps
only Search, + Create, Activity and the profile.

## Decisions

1. **One header, drawn from the shell core.** `OrganizationWorkspaceHeader`
   (`components/layout/organization-workspace-header.tsx`) reads
   `ShellCoreDTO.activeWorkspace` and the new `ShellCoreDTO.organization`
   (`standalone`, `logoUrl`). Both come from the verified context, so nothing
   is fetched to draw the header (§57). The options still stream in NAV-02's
   `workspaces` slot. The header can be pressed at once: its popup shows
   loading, or a failure with Retry, until the list is in. The old top-bar
   slot kept a disabled placeholder until then. When there is nothing to
   switch to, the header is identity only (`role="group"`, no button, §46).
   It owns no rule (§10). Choosing an option hands it to the switch.

2. **No icon at all in the header.** An arrow is never drawn (§4), and the
   header draws no icon of any kind: the mark is the logo image or initials in
   a span. Pressability comes from the hover and open backgrounds, the pointer
   cursor and the global focus ring. `expectNoArrow` in the E2E asserts zero
   `svg` elements in every state.

3. **The popup is a Radix Popover in the sidebar, and a bottom sheet in the
   drawer.** `@radix-ui/react-popover` 1.1.23 was added. It uses the same
   popper and dismissable-layer versions the lockfile already had. The
   Popover opens to the right of the sidebar, aligned to the header's top
   (§21), and collision handling keeps it on screen. The phone and tablet
   drawer opens the same content as a `Drawer side="bottom"` (§48, §49). The
   body remains NAV-03's lazily loaded chunk (`panels/workspace-panel-body.tsx`),
   now laid out as the PRD lays it out:
   - "Switch Workspace";
   - GROUP, with "All accessible Group data";
   - COMPANIES, in alphabetical order;
   - filled and hollow selection dots;
   - a search from five companies up.

   The list is an `aria-activedescendant` listbox. Focus starts on the
   search field, or on the list when there is no search field, with the
   current workspace active (§55).

4. **The switch is made in place.** This supersedes ADR 0011 §9 and NAV-01 §7
   for the header only.
   - PRD §34 asks for no full page load and for the shell to stay visible.
   - `WorkspaceSwitchProvider` (`components/workspace/workspace-switch-provider.tsx`)
     posts to the same `/api/workspace`, so validation, the route resolver
     and the audit trail are unchanged.
   - It then runs `router.refresh()` in a transition, after
     `router.replace(destination)` when the resolver moved the page. In Next
     15.5 the refresh fetches the whole tree from the root and replaces the
     entire prefetch cache (`refresh-reducer`: `revalidateEntireCache` /
     `prefetchCache = new Map()`), so the header, the navigation and the page
     commit together (§33).
   - AppShell keys the page content by `workspaceKey`, so no client state of
     the old workspace survives.

   While the switch runs:
   - the content region is covered by a skeleton;
   - the sidebar and top bar stay in view but are `inert` (`[data-shell-region]`);
   - the header keeps the old identity and is `aria-busy`.

   Outcomes:
   - A refusal changes nothing and says so (§35).
   - A fallback says why the page changed; an exact keep says nothing (§36).
   - An unanswered request is re-read with a refresh.
   - If the shell comes back with the old context key after a switch the
     server confirmed, the tab loads the page as a new document. This happens
     when a navigation started during the switch cancels the refresh.

   Other tabs still reload through `WorkspaceSync` (§62). The other
   switch-then-go flows keep `openInSwitchedWorkspace` and are unchanged:
   the record hop, the Quick Create launch, `ChooseCompany` and `EnterCompany`.

5. **Unsaved changes are asked about inside the popup (§37).** When
   `hasWorkspaceDirtyState()` is set, the popup asks "You have unsaved
   changes." with two buttons:
   - **Stay**, which is focused and closes the popup;
   - **Discard and switch**.

   This replaces the browser `confirm` for this path. The switch then passes
   `confirmed: true`, so nothing asks twice.

6. **A standalone company has no Group level.** Every company has a parent
   group, so "a customer with no Parent Group" (§8, §45) is a group that holds
   exactly one company. `ParentGroupContext.standalone` comes from a relation
   count on the row the context loaders already read
   (`PARENT_GROUP_FOR_CONTEXT`), so it adds no query. In such a tenant:
   - `mayEnterGroupWorkspace` is false, so there is no Group option and
     `switchWorkspace` answers 403 for GROUP;
   - the session resolver keeps the session in COMPANY, or moves it back
     there;
   - `hasWorkspaceChoice` does not count group standing.

   The header names the company alone (§86). This is the one access-rule
   change in the PRD. Before it, an Owner of a one-company tenant started in
   a Group workspace. That workspace was the same company, and writes there
   were refused with 409.

7. **Tenant branding is data, and only what the CSP can draw.**
   `ParentGroup.logoUrl` and `Company.logoUrl` already existed, and nothing
   wrote them.
   - `ParentGroupContext` now carries the group's logo.
   - `resolveShellLogo` picks the group's logo, then the company's in a
     company workspace only, then none (the mark shows initials, §12, §51).
   - The platform console sets them: a new `group.branding` command (the
     Branding button on a group, audited as `PLATFORM_GROUP_BRANDING_CHANGED`)
     and a Logo field in the company editor.
   - `isShellLogoSource` accepts only sources the CSP (`img-src 'self' data:
     blob:`) can draw: a same-origin path that is not under `/api/`, or a
     base64 `data:image/…` of at most 96 000 characters.
   - The audit trail records a path as itself and an inline image by its kind
     and size, never its bytes.
   - The group's name remains its display name, so a rename flows through
     (§69).

8. **"Demo data" moved to the sidebar foot.** D-01 §68 says a demonstration
   tenant says so on every page. The notice now sits beside "Powered by
   NESTO" in the sidebar foot and the drawer foot. On the 72 px rail, which
   has no foot, a compact "Demo" marker stands in. The dashboard hero keeps
   its disclaimer.

9. **"Group Company" is now "Group Workspace".** §7 and §23 say the group
   is a scope, not a company. The English and Albanian strings changed
   together.

## Consequences

- The phone top bar shows the organization's mark as the way home, where
  it used to show the NESTO lockup (§5, §6). The drawer leads with the
  header.
- `WorkspaceSlot`, `WorkspaceLabel` and `workspace-switcher.tsx` are gone.
  `useShellCore` and `useWorkspaceOptions` in `shell-slots.tsx` serve the
  header.
- A seeded fixture tenant, Solo Studio (`group_fixture_solo`, user
  `solo-owner`), is the standalone case for tests. It is a test fixture, so
  the platform console and the demo sign-in list never show it.
- Intent prefetch pauses during an in-place switch
  (`isWorkspaceSwitchInPlace`), so nothing is prepared for the workspace
  being left.
