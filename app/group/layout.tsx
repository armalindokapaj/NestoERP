import type { Metadata } from "next";

import { GroupPageBoundary } from "@/components/group/group-page-boundary";
import { GroupShell } from "@/components/group/group-shell";
import { ModuleMessages } from "@/components/i18n/module-messages";
import { LiveAnnouncer } from "@/components/layout/live-announcer";
import { NeutralPageSkeleton } from "@/components/layout/page-skeletons";
import { RouteFocus } from "@/components/layout/route-focus";
import { SkipLink } from "@/components/layout/skip-link";
import { ResponseBeats } from "@/components/navigation/reveal-watchdog";
import { PasswordChangeNotice } from "@/components/platform/password-change-notice";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UnsavedHost } from "@/components/unsaved/unsaved-host";
import { canGroup, requireGroupContext } from "@/lib/context/group-context";
import { identityKeys } from "@/lib/context/identity-key";
import { getTranslations } from "@/lib/i18n/server";
import { getDesignState } from "@/lib/layout/design-server";

export async function generateMetadata(): Promise<Metadata> {
  const title = (await getTranslations("group"))("shell.title");
  return { title: { template: `%s · ${title}`, default: title } };
}

/**
 * The area of a person who belongs to a parent group and to no company
 * (Admin PRD #9). Outside the company shell on purpose: that shell is built
 * from a company context and this session has none. Nothing here reads or
 * invents a company.
 */
export default async function GroupLayout({ children }: { children: React.ReactNode }) {
  const context = await requireGroupContext();
  const to = await getTranslations("adminOrgs");
  const roleName = to(`groupUsers.role${context.roleKey}`);
  // Which display preferences the account panel may offer (UI-02 §15, §33): client code cannot read the environment.
  const { options: appearance, version } = await getDesignState();
  return (
    <ModuleMessages namespaces={["group", "adminOrgs", "adminAccess", "admin"]}>
      <ToastProvider>
        <TooltipProvider>
          <UnsavedHost identity={identityKeys(context)} workspace={null} />
          <SkipLink />
          <LiveAnnouncer />
          <RouteFocus />
          <ResponseBeats />
          <GroupShell
            group={{ name: context.groupName, roleName }}
            user={{ id: context.userId, firstName: context.firstName, lastName: context.lastName }}
            capabilities={{ companies: canGroup(context, "group.companies.view"), users: canGroup(context, "group.users.view"), roles: canGroup(context, "group.roles.view") }}
            appearance={appearance}
          >
            <PasswordChangeNotice userId={context.userId} href="/group/account" />
            {/* Version 2: a page on its way shows a skeleton inside the shell (UI-02 §16.1); version 1's pages arrive whole, as before. */}
            {version === "2" ? <GroupPageBoundary fallback={<NeutralPageSkeleton />}>{children}</GroupPageBoundary> : children}
          </GroupShell>
        </TooltipProvider>
      </ToastProvider>
    </ModuleMessages>
  );
}
