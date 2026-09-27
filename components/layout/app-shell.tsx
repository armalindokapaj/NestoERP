import * as React from "react";
import { cookies } from "next/headers";

import { DevAccessPanel } from "@/components/layout/dev-access-panel";
import { BannerSlot, ShellSlotsProvider } from "@/components/layout/shell-slots";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-provider";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MODULE_KEYS, modules } from "@/config/modules";
import { isDevMode } from "@/lib/auth/dev-mode";
import { Metric, recordDuration } from "@/lib/core/observability/metrics";
import { grantsInCompany, loadOrganizationAccessFor, type OrganizationAccess } from "@/lib/context/organization-access";
import { criticalAnnouncementBanner } from "@/lib/modules/announcements/announcement.service";
import type { UserContext } from "@/lib/context/types";
import { SIDEBAR_COOKIE, readSidebarState } from "@/lib/layout/sidebar-state";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";
import { WorkspaceSwitchProvider } from "@/components/workspace/workspace-switch-provider";
import { WorkspaceSync } from "@/components/workspace/workspace-sync";
import { UnsavedHost } from "@/components/unsaved/unsaved-host";
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
 * Navigation is resolved once, here, and handed to both the desktop sidebar and
 * the mobile drawer, so the two can never disagree (PRD #3 §99).
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
  const sidebarState = readSidebarState(cookieStore.get(SIDEBAR_COOKIE)?.value);

  // Optional reads start now and are awaited only in their slots. The banner is
  // read in this member's audience (PRD #45 §67, §122); the access debugger's
  // grants are the organization snapshot the context was built from, read once
  // for the request (QUERY-01), and only where the panel exists.
  const workspaces = settleSlot("workspaces", () => listWorkspaces(context));
  const banner = settleSlot("banner", () => criticalAnnouncementBanner(context));
  const organization = isDevMode ? settleSlot("diagnostics", () => loadOrganizationAccessFor(context.parentGroupId, context.userId)) : null;

  // Resolved once, here, for the active workspace, and handed to the sidebar and
  // the drawer alike (Workspace Context §24). Never kept across a workspace change.
  const [navigation, core] = await Promise.all([resolveWorkspaceNavigation(context), resolveShellCore(context)]);
  recordDuration(Metric.SHELL_CORE_READY_MS, Metric.SHELL_CORE_READY, startedAt, { scope: context.workspace.scopeType });

  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
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
        {/* Immediate navigation feedback (NAV-01 §7). Keyed by the opaque context
            key, so nothing pending outlives the identity or workspace it began in. */}
        <NavigationFeedbackProvider identityKey={core.contextKey}>
          <NavigationFeedbackIndicator />
          {/* Sampled navigation telemetry: 10 % of documents unless configured (NAV-03 TELEMETRY-02). */}
          <PerformanceGate sampleRate={telemetrySampleRate()} />
          {/* Off with NESTO_INTENT_PREFETCH=off: links keep ordinary navigation (NAV-03 §19). */}
          <IntentPrefetchProvider contextKey={core.contextKey} enabled={process.env.NESTO_INTENT_PREFETCH !== "off"}>
          <ShellSlotsProvider core={core} workspaces={workspaces} banner={banner}>
            <SidebarProvider initial={sidebarState} className="min-h-dvh bg-canvas">
              {/* One workspace switch at a time, in place, from the sidebar header or the drawer (OW §28-§36). */}
              <WorkspaceSwitchProvider
                contextKey={core.contextKey}
                currentName={context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name}
              >
              <Sidebar navigation={navigation} isDemo={context.parentGroup.isDemo} />

              <div className="pl-[var(--nesto-nav-width)] transition-[padding]">
                <Topbar context={context} navigation={navigation} core={core} />
                {/* The banner's height is reserved and stands in for the top padding,
                    so a late banner moves nothing under a pointer (SHELL-03). */}
                <BannerSlot />
                {/* Focusable by script only (tabIndex -1): the navigation drawer hands
                    focus here after a navigation (AUD-04 §4, MW-02). The gutters
                    include the safe-area insets, which viewport-fit=cover makes real. */}
                <main
                  id="nesto-main"
                  tabIndex={-1}
                  className="mx-auto w-full min-w-0 max-w-[1600px] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] outline-none md:pb-8 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8"
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
                      group: { name: context.parentGroup.name },
                      company: context.workspace.scopeType === "COMPANY"
                        ? { id: context.workspace.companyId!, name: context.company.name }
                        : null,
                    }}
                  >
                    {children}
                  </RecordNavigationProvider>
                </main>
              </div>

              </WorkspaceSwitchProvider>

              {/* Development only: never mounted in a production build
                  (PRD #9 §211). Streamed, so its read never holds up the page (SHELL-04). */}
              {isDevMode && organization ? (
                <React.Suspense fallback={null}>
                  <DevAccessPanelSlot context={context} organization={organization} />
                </React.Suspense>
              ) : null}
            </SidebarProvider>
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
