import { getTranslations } from "@/lib/i18n/server";
import { PageContainer } from "@/components/ui/page-container";
import { BreadcrumbRegistryProvider } from "@/components/navigation/breadcrumb-registry";
import { PageMenuProvider } from "@/components/navigation/page-menu";
import { MobileActionBarHost, MobileActionBarProvider } from "@/components/ui/mobile-action-bar";
import { PullToRefresh } from "@/components/layout/pull-to-refresh";
import { SectionStoreProvider } from "@/components/navigation/section-registry";
import { BreadcrumbBar } from "@/components/ui/breadcrumbs";
import * as React from "react";
import { cookies } from "next/headers";

import { DevAccessPanel } from "@/components/layout/dev-access-panel";
import { LiveAnnouncer } from "@/components/layout/live-announcer";
import { RouteFocus } from "@/components/layout/route-focus";
import { SkipLink } from "@/components/layout/skip-link";
import { BannerSlot, ShellSlotsProvider } from "@/components/layout/shell-slots";
import { DesktopDock } from "@/components/layout/desktop-dock";
import { ActionRibbon } from "@/components/layout/action-ribbon";
import { PocketRibbon } from "@/components/layout/pocket-ribbon";
import { Ribbon } from "@/components/layout/ribbon";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MODULE_KEYS, modules } from "@/config/modules";
import { isDevMode } from "@/lib/auth/dev-mode";
import { Metric, recordDuration } from "@/lib/core/observability/metrics";
import { grantsInCompany, loadOrganizationAccessFor, type OrganizationAccess } from "@/lib/context/organization-access";
import { criticalAnnouncementBanner } from "@/lib/modules/announcements/announcement.service";
import type { UserContext } from "@/lib/context/types";
import { DESKTOP_NAV_COOKIE, PHONE_NAV_COOKIE, readDesktopNav, readPhoneNav } from "@/lib/layout/nav-layout";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";
import { WorkspaceSwitchProvider } from "@/components/workspace/workspace-switch-provider";
import { WorkspaceSync } from "@/components/workspace/workspace-sync";
import { UnsavedHost } from "@/components/unsaved/unsaved-host";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { OfflineStatus } from "@/components/offline/offline-status";
import { identityKeys } from "@/lib/context/identity-key";
import { RecordNavigationProvider } from "@/components/navigation/record-navigation-provider";
import { NavigationFeedbackIndicator, NavigationFeedbackProvider } from "@/components/navigation/navigation-feedback";
import { IntentPrefetchProvider } from "@/components/navigation/intent-prefetch";
import { PerformanceGate } from "@/components/navigation/performance-gate";
import { workspaceKey } from "@/config/workspace";
import { resolveShellCore } from "@/lib/workspace/shell-core";
import { settleSlot, type SlotResult } from "@/lib/workspace/shell-slots";
import { listWorkspaces } from "@/lib/workspace/workspace.service";

/**
 * The one NESTO application shell (PRD #3 §2, §97).
 *
 * Every authenticated route renders inside this. The structure never changes
 * between roles — only the resolved navigation passed into it does. There is no
 * separate shell for Owner, Finance or Architect (PRD #3 §2).
 *
 * Navigation is resolved once, here, and handed to the desktop navigation and
 * the phone's, so the two can never disagree (PRD #3 §99). Which desktop
 * navigation (the Ribbon or the Dock) and which phone navigation (the Pocket
 * Ribbon or the Action Ribbon) is the person's choice in Settings › Appearance, read
 * from its cookies so the server draws the right one on the first paint
 * (docs/ui/UI-04-navigation-layouts.md).
 *
 * Content is capped at 1600px (PRD #3 §87) and padded across mobile, tablet and
 * desktop (PRD #7 §83).
 *
 * The frame waits only for what it cannot be drawn without (NAV-02 SHELL-01):
 * the verified context, the permitted navigation and the shell core. The
 * workspace chooser, the critical banner and the development access panel are
 * started here and awaited only in their own slots, so a slow one delays
 * nothing but itself.
 */
export async function AppShell({
  context,
  startedAt,
  children,
}: {
  context: UserContext;
  /** When the layout began the request's shell work, for `shell_core_ready_ms` (NAV-02 PERF-01). */
  startedAt: number;
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const desktopNav = readDesktopNav(cookieStore.get(DESKTOP_NAV_COOKIE)?.value);
  const phoneNav = readPhoneNav(cookieStore.get(PHONE_NAV_COOKIE)?.value);

  // Optional reads start now and are awaited only in their slots. The banner is
  // read in this member's audience (PRD #45 §67, §122); the access debugger's
  // grants are the organization snapshot the context was built from, read once
  // for the request (QUERY-01), and only where the panel exists.
  const workspaces = settleSlot("workspaces", () => listWorkspaces(context));
  const banner = settleSlot("banner", () => criticalAnnouncementBanner(context));
  const organization = isDevMode ? settleSlot("diagnostics", () => loadOrganizationAccessFor(context.parentGroupId, context.userId)) : null;

  // Resolved once, here, for the active workspace, and handed to the desktop and
  // the phone navigation alike (Workspace Context §24). Never kept across a workspace change.
  const [navigation, core, roleLabels] = await Promise.all([resolveWorkspaceNavigation(context), resolveShellCore(context), getTranslations("roles")]);
  recordDuration(Metric.SHELL_CORE_READY_MS, Metric.SHELL_CORE_READY, startedAt, { scope: context.workspace.scopeType });

  // The account the phone navigation's Company tab holds, whichever phone navigation is drawn.
  const account = {
    firstName: context.firstName,
    lastName: context.lastName,
    avatarUrl: context.avatarUrl,
    roleLabel: roleLabels(`${context.role}.label`),
    workspaceName: context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        {/* First in the tab order: Skip to main content (AUD-11 §3, AV-02). The two stable
            live regions and focus placement after an accepted navigation (§4, §5). */}
        <SkipLink />
        <LiveAnnouncer />
        <RouteFocus />
        <WorkspaceSync />
        {/* Unsaved work (AUD-03): the one prompt, the unload guard, Back/Forward,
            and what happens when this tab's context stops being the server's.
            Above the workspace-keyed page, so it outlives every editor. */}
        <UnsavedHost
          identity={identityKeys(context)}
          workspace={{
            key: workspaceKey(context.workspace),
            scopeType: context.workspace.scopeType,
            companyId: context.workspace.companyId,
            parentGroupId: context.workspace.parentGroupId,
            name: context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name,
          }}
        />
        {/* Offline work (MOB-09): opens this person's local database, sends what they queued, and asks before a sign-out that would leave work behind. */}
        <OfflineProvider userId={context.userId} />
        {/* Immediate navigation feedback (NAV-01 §7). Keyed by the opaque context
            key, so nothing pending outlives the identity or workspace it began in. */}
        <NavigationFeedbackProvider identityKey={core.contextKey}>
          <NavigationFeedbackIndicator />
          {/* Sampled navigation telemetry: 10 % of documents unless configured (NAV-03 TELEMETRY-02). */}
          <PerformanceGate sampleRate={telemetrySampleRate()} />
          {/* Off with NESTO_INTENT_PREFETCH=off: links keep ordinary navigation (NAV-03 §19). */}
          <IntentPrefetchProvider contextKey={core.contextKey} enabled={process.env.NESTO_INTENT_PREFETCH !== "off"}>
          <ShellSlotsProvider core={core} workspaces={workspaces} banner={banner}>
            {/* `data-app-shell`: the root of a signed-in shell (UI-02 §6.2, tokens-v2.css). */}
            <div data-app-shell className="min-h-dvh bg-canvas">
              {/* One workspace switch at a time, in place, from the top bar or the phone's header (OW §28-§36). */}
              <WorkspaceSwitchProvider
                contextKey={core.contextKey}
                currentName={context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name}
              >
              {/* Keyed by the workspace: a switch made in place remounts the page, so
                  no client state of the old workspace outlives it (OW §33). */}
              <RecordNavigationProvider
                    key={workspaceKey(context.workspace)}
                    workspace={{
                      key: workspaceKey(context.workspace),
                      scopeType: context.workspace.scopeType,
                      companyId: context.workspace.companyId,
                      // Whether the Group view can be entered streams in with the chooser (COMPAT-01).
                      group: { name: context.parentGroup.name, standalone: context.parentGroup.standalone },
                      company: context.workspace.scopeType === "COMPANY"
                        ? { id: context.workspace.companyId!, name: context.company.name }
                        : null,
                    }}
              >
              <BreadcrumbRegistryProvider>
              {/* A page's tab rows hand their sections to the phone Ribbon's This page below lg, and the module's row to the desktop Ribbon (section-registry.tsx). */}
              <SectionStoreProvider>
              {/* A page's tips and Help fold into its one ⋯ menu, right after its title or status, and below lg its secondary actions too (components/navigation/page-menu.tsx). */}
              <PageMenuProvider>
              {/* Below md a detail page's main action moves to the phone's bottom: its own bar above the Pocket Ribbon, or into the Action Ribbon (components/ui/mobile-action-bar.tsx). */}
              <MobileActionBarProvider>
              <div>
                {/* With the Ribbon chosen, it is drawn under the top bar's row, in the same sticky header. */}
                <Topbar context={context} core={core} ribbon={desktopNav === "ribbon" ? <Ribbon navigation={navigation} /> : undefined} />
                {/* The one sticky breadcrumb bar, directly under the top bar (Sticky Navigation §3). */}
                <BreadcrumbBar />
                {/* Connectivity and sync, compact; nothing at all while online with nothing to send (MOB-09 §24, §116). */}
                <OfflineStatus />
                {/* A critical banner, when there is one; it takes no room otherwise. */}
                <BannerSlot />
                {/* Focusable by script only (tabIndex -1): the navigation drawer hands
                    focus here after a navigation (AUD-04 §4, MW-02). The gutters
                    include the safe-area insets, which viewport-fit=cover makes real. */}
                <PageContainer as="main" id="nesto-main" tabIndex={-1} className="outline-none">
                  {children}
                  {/* With the Pocket Ribbon, the page's main action on a phone, pinned above it; nothing while the page has none.
                      Inside the main region, after the page's content: it is the page's own, and read after it.
                      The Action Ribbon carries the page's main actions in its own bar instead. */}
                  {phoneNav === "pocket" ? <MobileActionBarHost /> : null}
                </PageContainer>
                {/* Pull down at the top of a phone screen to read the page again (mobile audit 5c). */}
                <PullToRefresh />
                {/* The desktop Dock, when it is the chosen desktop navigation; from lg. */}
                {desktopNav === "dock" ? <DesktopDock navigation={navigation} /> : null}
                {/* The phone and tablet-portrait navigation, below lg: the desktop Ribbon brought to the phone, as the
                    Pocket Ribbon (the default) or the Action Ribbon (docs/ui/UI-04-navigation-layouts.md). */}
                {phoneNav === "action" ? (
                  <ActionRibbon navigation={navigation} canCreate={core.quickCreate.canOpen} account={account} />
                ) : (
                  <PocketRibbon navigation={navigation} canCreate={core.quickCreate.canOpen} account={account} />
                )}
              </div>
              </MobileActionBarProvider>
              </PageMenuProvider>
              </SectionStoreProvider>
              </BreadcrumbRegistryProvider>
              </RecordNavigationProvider>

              </WorkspaceSwitchProvider>

              {/* Development only: never mounted in a production build
                  (PRD #9 §211). Streamed, so its read never holds up the page (SHELL-04). */}
              {isDevMode && organization ? (
                <React.Suspense fallback={null}>
                  <DevAccessPanelSlot context={context} organization={organization} />
                </React.Suspense>
              ) : null}
            </div>
          </ShellSlotsProvider>
          </IntentPrefetchProvider>
        </NavigationFeedbackProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}

/** The access debugger, once its organization snapshot is in hand; nothing at all if it failed. */
async function DevAccessPanelSlot({ context, organization }: { context: UserContext; organization: Promise<SlotResult<OrganizationAccess>> }) {
  const result = await organization;
  return (
    <DevAccessPanel
      snapshot={{
        user: context.fullName,
        userId: context.userId,
        sessionId: context.sessionId,
        membershipId: context.membershipId,
        company: context.company.name,
        role: `${context.roleLabel} (${context.role})`,
        position: context.position,
        department: context.department?.name ?? "—",
        assignments: context.assignments.map(
          (assignment) =>
            `${assignment.positionLevel} · ${assignment.groupDepartmentName}${assignment.companyId ? "" : " (group)"} · ${assignment.functionalRoleKey}`,
        ),
        grants: result.ok
          ? grantsInCompany(result.data.grants, context.parentGroupId, context.companyId).map(
              (grant) => `${grant.moduleKey} ${grant.accessLevel} · ${grant.scopeType}`,
            )
          : [],
        permissionCount: context.permissions.length,
        modules: Object.fromEntries(
          MODULE_KEYS.map((key) => [
            key,
            {
              label: modules[key].label,
              accessLevel: context.moduleAccess[key].enabled ? context.moduleAccess[key].accessLevel : "DISABLED",
              scope: context.moduleAccess[key].scope,
              permissions: context.moduleAccess[key].permissions,
            },
          ]),
        ),
      }}
    />
  );
}

/** The share of documents that record navigation telemetry; server configuration, never the browser's. */
function telemetrySampleRate(): number {
  if (process.env.NESTO_NAV_TELEMETRY === "off") return 0;
  const configured = Number(process.env.NESTO_NAV_TELEMETRY_SAMPLE ?? "0.1");
  return Number.isFinite(configured) ? Math.min(1, Math.max(0, configured)) : 0.1;
}
