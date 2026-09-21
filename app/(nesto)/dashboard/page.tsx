import type { Metadata } from "next";

import { DashboardGrid, KpiGrid } from "@/components/dashboard/dashboard-grid";
import { DashboardWidget } from "@/components/dashboard/dashboard-widget";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { GroupHero } from "@/components/dashboard/group-hero";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import { requireUserContext } from "@/lib/context/current-user";
import { groupIdentity } from "@/lib/modules/dashboard/dashboard.group";
import { resolveDashboard } from "@/lib/modules/dashboard/dashboard.service";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The one dashboard route (PRD #4 §4). The group's Owner and the heads of its
 * functions see the group above their own (D-01 §25).
 *
 * There is no /dashboard/architect and no /dashboard/finance. Every one of the
 * 18 roles lands here, and the resolver decides what they see from their role,
 * permissions and data scope (PRD #4 §103).
 */
export default async function DashboardPage() {
  const context = await requireUserContext();
  // The group's banner is the Group workspace's (D-01 §26, §66; Workspace Context §18).
  const [dashboard, group] = await Promise.all([resolveDashboard(context), groupIdentity(context).catch(() => null)]);

  return (
    <div className="space-y-6">
      <WelcomeHeader context={context} focus={dashboard.focus} />

      {group ? <GroupHero identity={group} /> : null}

      <QuickActions actions={dashboard.quickActions} />

      {dashboard.kpis.length > 0 ? (
        <KpiGrid count={dashboard.kpis.length}>
          {dashboard.kpis.map((kpi) => (
            <KpiCard key={kpi.definition.key} kpi={kpi} />
          ))}
        </KpiGrid>
      ) : null}

      <DashboardGrid>
        {dashboard.widgets.map((widget) => (
          <DashboardWidget key={widget.definition.key} widget={widget} />
        ))}
      </DashboardGrid>
    </div>
  );
}
