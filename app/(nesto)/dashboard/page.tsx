import type { Metadata } from "next";

import { DashboardGrid, KpiGrid } from "@/components/dashboard/dashboard-grid";
import { DashboardWidget } from "@/components/dashboard/dashboard-widget";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import { requireUserContext } from "@/lib/context/current-user";
import { resolveDashboard } from "@/lib/modules/dashboard/dashboard.service";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The one dashboard route (PRD #4 §4).
 *
 * There is no /dashboard/architect and no /dashboard/finance. Every one of the
 * 16 roles lands here, and the resolver decides what they see from their role,
 * permissions and data scope (PRD #4 §103).
 */
export default async function DashboardPage() {
  const context = await requireUserContext();
  const dashboard = await resolveDashboard(context);

  return (
    <div className="space-y-6">
      <WelcomeHeader context={context} focus={dashboard.focus} />

      <QuickActions actions={dashboard.quickActions} />

      {dashboard.kpis.length > 0 ? (
        <KpiGrid>
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
