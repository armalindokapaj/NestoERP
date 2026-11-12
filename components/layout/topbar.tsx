import { GlobalSearch } from "@/components/layout/global-search";
import { ActivityBell } from "@/components/layout/activity-bell";
import { HomeLink, ModulesPanel } from "@/components/layout/modules-panel";
import { PhoneInbox } from "@/components/layout/phone-inbox";
import { PhoneTitle } from "@/components/layout/phone-title";
import { QuickCreate } from "@/components/layout/quick-create";
import { RibbonPanel, RibbonProvider, RibbonTabs, RibbonUnits } from "@/components/layout/ribbon";
import { AccountPanel } from "@/components/shell/account-panel";
import type { Navigation } from "@/config/navigation";
import { can, canAccessModule } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import type { ShellCoreDTO } from "@/lib/workspace/shell-core";

/**
 * The one top bar (PRD #3 §16, §76; UI-01 §5; docs/ui/UI-04-navigation-layouts.md).
 * Identical for every role, and it stays at the top as the page scrolls.
 *
 *   [ logo · Home ·     Units · + Create ]   ( Work | Company | Sales | Procurement | Finance )   [ Search…     ⌘K · bell · account ]
 *
 * Three columns, the two sides equal: from `lg` each side is the same width
 * (`--nesto-bar-side`), its content running from the outer edge to the inner
 * one, so the Ribbon's tabs sit in the middle with the same space either side.
 * The left is where you are and what you make — the logo, which opens every
 * module in a panel on the left third of the screen; the company name, Home;
 * Units, pinned for every role that may see units; + Create. The right is the
 * universal cluster in its order, Search, Notifications, Account (UI-01 §1),
 * the search field taking what is left.
 * Every control is 40px and every label 14px medium, on one centre line.
 * Under the bar, the open tab's ribbon, which folds away to leave the bar alone.
 *
 * One height, `--nesto-shell-header-h`, covers the bar and the open ribbon, so
 * every layer pinned under the header lines up (styles/globals.css). Every
 * panel opened from the bar starts on the row's lower edge (lib/layout/topbar-line.ts).
 *
 * Below `lg` the bar is where you are, search and Inbox: Back when there is
 * somewhere to go back to, the page's (or the project's) name
 * (components/layout/phone-title.tsx), then search and Inbox in cells of their
 * own at the end (components/layout/phone-inbox.tsx), Inbox where the bell
 * stands on a desktop and carrying its count. Create, the account and every
 * module are the phone's bar at the bottom (components/layout/phone-bar.tsx):
 * New and Menu. The gutters include the safe-area insets.
 */
export async function Topbar({
  context,
  core,
  navigation,
  ribbonFolded,
}: {
  context: UserContext;
  core: ShellCoreDTO;
  navigation: Navigation;
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
    <header data-shell-region className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-(--nesto-shell-header-h) flex-col border-b border-fg">
      {/* Glass (UI-05 §9): 82% of the page and a 14px blur under the bar and the ribbon, so the page blurs as it scrolls under them. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/82 backdrop-blur-[14px] backdrop-saturate-[1.3]" />
      <RibbonProvider navigation={navigation} folded={ribbonFolded}>
      <div
        data-topbar-row
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-stretch pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-x-4 lg:pl-[max(1.5rem,env(safe-area-inset-left))] lg:pr-[max(1.5rem,env(safe-area-inset-right))] xl:gap-x-8 xl:px-8"
      >
        {/* Below lg: Back, and where you are. */}
        <PhoneTitle />
        {/* From lg: where you are and what you make. Below lg only Quick Create's panel is left of it, opened by New in the phone's bar. */}
        <div className="col-start-1 flex min-w-0 items-center gap-1.5 max-lg:contents lg:w-full lg:max-w-(--nesto-bar-side)">
          <div className="contents max-lg:hidden">
            <ModulesPanel navigation={navigation} />
            <HomeLink />
          </div>
          {/* A demonstration tenant says so on every page (D-01 §68). */}
          {context.parentGroup.isDemo ? (
            <span title={shell("demoDisclaimer")} data-testid="demo-notice" className="inline-flex shrink-0 rounded-none border border-line px-2 py-px text-micro font-medium text-fg-muted max-xl:hidden">
              <span aria-hidden="true">{shell("demoData")}</span>
              <span className="sr-only">{shell("demoDisclaimer")}</span>
            </span>
          ) : null}
          {/* From lg, Units and + Create stand at the side's inner edge, as the search field does on the right. */}
          <span aria-hidden="true" className="hidden flex-1 lg:block" />
          <RibbonUnits navigation={navigation} />
          {/* Only what this person may create here; hidden when that is nothing (Quick Create §4, §150). The menu loads only when opened (NAV-01 QC-01). */}
          <QuickCreate userKey={context.userId} summary={core.quickCreate} />
        </div>

        {/* From lg: the Ribbon's five tabs, in the middle. */}
        <RibbonTabs className="col-start-2" />

        {/* The universal cluster in its order on every surface: Search, Notifications, Account (UI-01 §1). Below lg, Search and Inbox, each in a cell. */}
        <div className="col-start-3 flex min-w-0 items-center justify-end justify-self-end max-lg:items-stretch lg:w-full lg:max-w-(--nesto-bar-side) lg:gap-1.5" data-testid="global-actions">
          <div className="flex w-14 items-center justify-center border-l border-line-strong lg:contents">
            <GlobalSearch contextKey={core.contextKey} />
          </div>
          {/* One bell for notifications and announcements alike, across every company (Activity Center §3, §31).
              Below lg it is mounted but not drawn: Inbox, beside search, carries its count. */}
          <div className="contents max-lg:hidden">
            <ActivityBell contextKey={core.contextKey} canManageAnnouncements={context.permissions.includes("announcement.create")} />
          </div>
          {/* Below lg, you are in Menu. */}
          <div className="contents max-lg:hidden">
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
          {/* Below lg: Inbox, where the bell stands from lg. */}
          <PhoneInbox />
        </div>
      </div>
      {/* From lg: the open tab's ribbon. */}
      <RibbonPanel />
      </RibbonProvider>
    </header>
  );
}
