import { DashboardGrid, KpiGrid } from "@/components/dashboard/dashboard-grid";
import { DashboardWidget } from "@/components/dashboard/dashboard-widget";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import { dashboardForRole, kpis, widgets } from "@/config/dashboards";
import type { CurrentUser } from "@/lib/auth/types";

/**
 * The universal dashboard engine (spec §13, §51).
 *
 * Every one of the 16 roles renders through this component. A role's dashboard
 * is a list of KPI keys, widget keys and quick actions — there is no per-role
 * dashboard page anywhere in the codebase.
 */
export function RoleDashboard({ user }: { user: CurrentUser }) {
  const config = dashboardForRole(user.role);

  const roleKpis = config.kpis.map((key) => kpis[key]).filter(Boolean);
  const roleWidgets = config.widgets.map((key) => widgets[key]).filter(Boolean);

  return (
    <div className="space-y-6">
      <WelcomeHeader user={user} />

      <QuickActions actions={config.quickActions} user={user} />

      <KpiGrid>
        {roleKpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </KpiGrid>

      <DashboardGrid>
        {roleWidgets.map((widget) => (
          <DashboardWidget key={widget.key} widget={widget} />
        ))}
      </DashboardGrid>

      <p className="text-meta text-fg-subtle">
        Dashboard figures are demo data for V0.1. Each widget is switched to live
        data as its module becomes functional.
      </p>
    </div>
  );
}
