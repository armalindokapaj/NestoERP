import type { Metadata } from "next";

import { RoleDashboard } from "@/components/dashboard/role-dashboard";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The only dashboard page in NESTO (spec §13).
 * All 16 role dashboards are produced by RoleDashboard from configuration.
 */
export default async function DashboardPage() {
  const user = await requirePermission("dashboard.view");

  return <RoleDashboard user={user} />;
}
