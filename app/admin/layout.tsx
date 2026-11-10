import type { Metadata } from "next";
import { cookies } from "next/headers";


import { ModuleMessages } from "@/components/i18n/module-messages";
import { LiveAnnouncer } from "@/components/layout/live-announcer";
import { ResponseBeats } from "@/components/navigation/reveal-watchdog";
import { RouteFocus } from "@/components/layout/route-focus";
import { SkipLink } from "@/components/layout/skip-link";
import { PasswordChangeNotice } from "@/components/platform/password-change-notice";
import { PlatformShell } from "@/components/platform/platform-shell";
import { UnsavedHost } from "@/components/unsaved/unsaved-host";
import { identityKeys } from "@/lib/context/identity-key";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { SIDEBAR_COOKIE, readSidebarState } from "@/lib/layout/sidebar-state";

export const metadata: Metadata = {
  title: { template: "%s · NESTO Platform", default: "NESTO Platform" },
};

/**
 * The Platform Admin's own area (E-06 §116, §128).
 *
 * Outside the application shell on purpose: the shell is built from a company
 * context, and a platform session has none. Nothing in a company's sidebar
 * links here, and nothing here links into a company.
 */
export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requirePlatformContext();
  const sidebarState = readSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <ModuleMessages namespaces={["admin", "adminOrgs", "adminAccess", "adminPlatform"]}>
    <ToastProvider>
    <TooltipProvider>
    {/* Unsaved work (AUD-03): no workspace here, only the person. */}
    <UnsavedHost identity={identityKeys(context)} workspace={null} />
    {/* Skip link, announcer and route focus, as in the application shell (AUD-11 §3, AV-02, AV-09). */}
    <SkipLink />
    <LiveAnnouncer />
    <RouteFocus />
    {/* vercel/next.js#86151: a refreshed page is shown once its data lands, as in the application shell. */}
    <ResponseBeats />
    <PlatformShell
      user={{ id: context.userId, name: context.fullName, firstName: context.firstName, lastName: context.fullName.slice(context.firstName.length).trim(), email: context.email, username: context.username }}
      permissions={context.permissions}
      initialSidebar={sidebarState}
    >
      <PasswordChangeNotice userId={context.userId} href="/admin/account" />
      {children}
    </PlatformShell>
    </TooltipProvider>
    </ToastProvider>
    </ModuleMessages>
  );
}
