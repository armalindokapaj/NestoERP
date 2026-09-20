import { AppShell } from "@/components/layout/app-shell";
import { requireUserContext } from "@/lib/context/current-user";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import { redirect } from "next/navigation";

/**
 * Every authenticated NESTO route renders inside the one application shell
 * (PRD #3 §2, §73).
 *
 * Middleware has already checked that a session cookie exists; this is where
 * the real context is resolved from the database. Nothing below renders until
 * it succeeds, which is what prevents permission flashing (PRD #5 §128).
 */
export default async function NestoLayout({ children }: { children: React.ReactNode }) {
  const context = await requireUserContext();
  const maintenance = await getMaintenanceState();
  if (maintenance.enabled) redirect("/maintenance");

  return <AppShell context={context}>{children}</AppShell>;
}
