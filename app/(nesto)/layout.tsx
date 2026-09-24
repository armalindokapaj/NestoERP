import { AppShell } from "@/components/layout/app-shell";
import { requireUserContext } from "@/lib/context/current-user";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import { redirect } from "next/navigation";

import { runPreStreamGuard } from "./pre-stream-guards";

/**
 * Every authenticated NESTO route renders inside the one application shell
 * (PRD #3 §2, §73).
 *
 * Middleware has already checked that a session cookie exists; this is where
 * the real context is resolved from the database. Nothing below renders until
 * it succeeds, which is what prevents permission flashing (PRD #5 §128).
 *
 * This layout sits outside `loading.tsx` beside it (NAV-01 §2.1): sign-in,
 * the workspace, maintenance and the few routes with a pre-stream status
 * contract are all settled before anything streams.
 */
export default async function NestoLayout({ children }: { children: React.ReactNode }) {
  const context = await requireUserContext();
  // In parallel; maintenance still wins over a route's own refusal.
  const [maintenance, guard] = await Promise.allSettled([getMaintenanceState(), runPreStreamGuard()]);
  if (maintenance.status === "rejected") throw maintenance.reason;
  if (maintenance.value.enabled) redirect("/maintenance");
  if (guard.status === "rejected") throw guard.reason;

  return <AppShell context={context}>{children}</AppShell>;
}
