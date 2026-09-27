import { DEMO_DISCLAIMER } from "@/components/dashboard/group-hero";
import { OrganizationWorkspaceHeader } from "@/components/layout/organization-workspace-header";
import { PoweredBy } from "@/components/layout/powered-by";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import type { NavigationGroup } from "@/config/navigation";

/**
 * Persistent navigation (design spec §11, §12, §14, §44).
 *
 * Width is driven entirely by --nesto-nav-width, so the rail, the full
 * sidebar and the content offset can never disagree. Hidden below 1024px,
 * where navigation moves into the drawer.
 *
 * Three stacked parts (OW §18): the organization header, fixed at the top;
 * the navigation, which scrolls on its own; and the foot, fixed at the
 * bottom. The header names the customer organization and the workspace, and
 * is where the workspace is switched (OW §2, §3) — the NESTO wordmark no
 * longer stands there (OW §6). NESTO signs the foot instead, quietly (OW §71).
 * On the rail the header keeps its mark alone and the foot has no room at all;
 * which parts show is decided in CSS, so nothing swaps after hydration.
 *
 * The collapse control sits in the top bar, where it does not have to share
 * the one slot the rail header has.
 */
export function Sidebar({ navigation, isDemo }: { navigation: NavigationGroup[]; isDemo: boolean }) {
  return (
    <aside className="nesto-rail fixed inset-y-0 left-0 z-40 hidden w-[var(--nesto-nav-width)] flex-col border-r border-line bg-sidebar transition-[width] lg:flex">
      <div className="flex h-16 shrink-0 items-center px-3" data-testid="sidebar-header">
        <OrganizationWorkspaceHeader variant="sidebar" />
      </div>

      {/* Inert while a workspace switch is in flight (OW §34), like the foot and the top bar. */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-shell-region>
        <SidebarNav navigation={navigation} />
      </div>

      <div className="nesto-sidebar-footer shrink-0 px-5 pb-5 pt-4" data-shell-region>
        <PoweredBy isDemo={isDemo} />
      </div>
      {/* The rail has no room for the foot, but a demonstration tenant still says so on every page (D-01 §68). */}
      {isDemo ? (
        <p
          title={DEMO_DISCLAIMER}
          data-testid="demo-notice-rail"
          className="nesto-rail-only mx-auto mb-4 w-fit shrink-0 rounded-full border border-line px-1.5 py-px text-micro font-medium text-fg-muted"
        >
          {/* aria-label is not honoured on a paragraph; the disclaimer is its text instead (AUD-11 AV-06). */}
          <span aria-hidden="true">Demo</span>
          <span className="sr-only">{DEMO_DISCLAIMER}</span>
        </p>
      ) : null}
    </aside>
  );
}
