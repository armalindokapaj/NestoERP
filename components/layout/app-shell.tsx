import * as React from "react";
import { cookies } from "next/headers";

import { CriticalAnnouncementBanner } from "@/components/announcements/shell";
import { DevAccessPanel } from "@/components/layout/dev-access-panel";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-provider";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MODULE_KEYS, modules } from "@/config/modules";
import { isDevMode } from "@/lib/auth/dev-mode";
import { grantsInCompany, loadOrganizationAccessFor } from "@/lib/context/organization-access";
import { announcementShellState } from "@/lib/modules/announcements/announcement.service";
import type { UserContext } from "@/lib/context/types";
import { SIDEBAR_COOKIE, readSidebarState } from "@/lib/layout/sidebar-state";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";
import { WorkspaceSync } from "@/components/workspace/workspace-sync";

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
 */
export async function AppShell({
  context,
  children,
}: {
  context: UserContext;
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sidebarState = readSidebarState(cookieStore.get(SIDEBAR_COOKIE)?.value);

  // Resolved once, here, for the active workspace, and handed to the sidebar and
  // the drawer alike (Workspace Context §24). Never kept across a workspace change.
  // Unread count and the one critical banner, read in this member's audience (PRD #45 §67, §122).
  // The access debugger's grants are read only where it is shown.
  const [navigation, announcements, organization] = await Promise.all([
    resolveWorkspaceNavigation(context),
    announcementShellState(context).catch(() => ({ unread: 0, banner: null })),
    isDevMode ? loadOrganizationAccessFor(context.parentGroupId, context.userId).catch(() => null) : null,
  ]);

  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <WorkspaceSync />
        <SidebarProvider initial={sidebarState} className="min-h-dvh bg-canvas">
          <Sidebar navigation={navigation} />

          <div className="pl-[var(--nesto-nav-width)] transition-[padding]">
            <Topbar context={context} navigation={navigation} announcementsUnread={announcements.unread} />
            <CriticalAnnouncementBanner banner={announcements.banner} />
            <main
              id="nesto-main"
              className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8 xl:px-8"
            >
              {children}
            </main>
          </div>

          {/* Development only: never mounted in a production build
              (PRD #9 §211). */}
          {isDevMode ? (
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
                grants: organization
                  ? grantsInCompany(organization.grants, context.parentGroupId, context.companyId).map(
                      (grant) => `${grant.moduleKey} ${grant.accessLevel} · ${grant.scopeType}`,
                    )
                  : [],
                permissionCount: context.permissions.length,
                modules: Object.fromEntries(
                  MODULE_KEYS.map((key) => [
                    key,
                    {
                      label: modules[key].label,
                      accessLevel: context.moduleAccess[key].enabled
                        ? context.moduleAccess[key].accessLevel
                        : "DISABLED",
                      scope: context.moduleAccess[key].scope,
                      permissions: context.moduleAccess[key].permissions,
                    },
                  ]),
                ),
              }}
            />
          ) : null}
        </SidebarProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}
