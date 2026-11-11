import { GlobalSearch } from "@/components/layout/global-search";
import { ActivityBell } from "@/components/layout/activity-bell";
import { HomeLink, ModulesPanel } from "@/components/layout/modules-panel";
import { QuickCreate } from "@/components/layout/quick-create";
import { Ribbon } from "@/components/layout/ribbon";
import { AccountPanel } from "@/components/shell/account-panel";
import type { NavigationGroup } from "@/config/navigation";
import { can, canAccessModule } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import type { ShellCoreDTO } from "@/lib/workspace/shell-core";

/**
 * The one top bar (PRD #3 §16, §76; UI-01 §5; docs/ui/UI-04-navigation-layouts.md).
 * Identical for every role, and it stays at the top as the page scrolls.
 *
 *   logo · company name (Home) ·     Work  Sales  Procurement  Finance     · Create · Search · bell · account
 *
 * The logo opens every module in a panel on the left third of the screen; the
 * company name is Home, the Dashboard. From `lg` the Ribbon's four tabs sit
 * centred in the bar, and under it the open tab's ribbon, which folds away to
 * leave the bar alone. The right side keeps the universal cluster in its order,
 * Search, Notifications, Account (UI-01 §1), with + Create before it.
 *
 * One height, `--nesto-shell-header-h`, covers the bar and the open ribbon, so
 * every layer pinned under the header lines up (styles/globals.css). Every
 * panel opened from the bar starts on the row's lower edge (lib/layout/topbar-line.ts).
 *
 * Below `lg` the navigation is the phone Ribbon at the bottom
 * (components/layout/pocket-ribbon.tsx, action-ribbon.tsx), and on a phone the
 * account is at the foot of the logo's panel. The gutters include the
 * safe-area insets.
 */
export async function Topbar({
  context,
  core,
  navigation,
  ribbonFolded,
}: {
  context: UserContext;
  core: ShellCoreDTO;
  navigation: NavigationGroup[];
  /** The desktop ribbon folded away, from its cookie (lib/layout/nav-layout.ts). */
  ribbonFolded: boolean;
}) {
  const [roles, shell] = await Promise.all([getTranslations("roles"), getTranslations("shell")]);
  // The profile names the workspace beside the role, and switches nothing (OW §43, §66).
  const workspaceName = context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name;
  // Company Settings is offered only where its own page would open (settings-access.ts), never by title.
  const companySettings = context.workspace.scopeType === "COMPANY" && canAccessModule(context, "settings") && can(context, "company.name.update");
  const roleLabel = roles(`${context.role}.label`);

  return (
    // The blur sits on a layer behind the bar, not on the bar: a backdrop filter makes its
    // element the box that `position: fixed` children are placed in, which pinned the phone's
    // + Create bottom sheet to the bar's lower edge, above the screen (NAV-01 Q24).
    <header data-shell-region className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-(--nesto-shell-header-h) flex-col border-b border-fg bg-canvas">
      <div data-topbar-row className="flex min-h-0 flex-1 items-center gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ModulesPanel
            navigation={navigation}
            account={{ firstName: context.firstName, lastName: context.lastName, avatarUrl: context.avatarUrl, roleLabel, workspaceName }}
          />
          <HomeLink />
          {/* A demonstration tenant says so on every page (D-01 §68). */}
          {context.parentGroup.isDemo ? (
            <span title={shell("demoDisclaimer")} data-testid="demo-notice" className="inline-flex shrink-0 rounded-full border border-line px-2 py-px text-micro font-medium text-fg-muted max-xl:hidden">
              <span aria-hidden="true">{shell("demoData")}</span>
              <span className="sr-only">{shell("demoDisclaimer")}</span>
            </span>
          ) : null}
        </div>

        {/* + Create, then the universal cluster in its order on every surface: Search, Notifications, Account (UI-01 §1). */}
        <div className="flex shrink-0 items-center justify-end gap-0 sm:gap-1.5" data-testid="global-actions">
          {/* Only what this person may create here; hidden when that is nothing (Quick Create §4, §150). The menu loads only when opened (NAV-01 QC-01). */}
          <QuickCreate userKey={context.userId} summary={core.quickCreate} />
          <GlobalSearch contextKey={core.contextKey} />
          {/* One bell for notifications and announcements alike, across every company (Activity Center §3, §31). */}
          <ActivityBell contextKey={core.contextKey} canManageAnnouncements={context.permissions.includes("announcement.create")} />
          {/* Phone: the account is at the foot of the logo's panel. */}
          <div className="contents max-md:hidden">
            <AccountPanel
              model={{
                user: { firstName: context.firstName, lastName: context.lastName, avatarUrl: context.avatarUrl },
                roleLabel,
                workspaceName,
                destinations: {
                  profile: "/settings/profile",
                  settings: "/settings",
                  help: "/help",
                  whatsNew: "/whats-new",
                  organizationSettings: companySettings ? { href: "/settings/company", kind: "company" } : undefined,
                },
              }}
            />
          </div>
        </div>
      </div>
      {/* From lg: the four tabs, centred in the row above, and the open tab's ribbon here. */}
      <Ribbon navigation={navigation} folded={ribbonFolded} />
    </header>
  );
}
