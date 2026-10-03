import { AppShell } from "@/components/layout/app-shell";
import { PasswordChangeNotice } from "@/components/platform/password-change-notice";
import { ModuleMessages } from "@/components/i18n/module-messages";
import { requireUserContext } from "@/lib/context/current-user";
import { admitPage, getPageMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
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
 *
 * Maintenance is read beside authentication, from this process's page
 * snapshot when one is younger than five seconds (NAV-02 PAR-01, MAINT-01).
 * Authentication decides first: a signed-out visitor goes to sign-in whatever
 * maintenance says, and a maintenance read that fails meanwhile is handled,
 * never left unhandled. The snapshot's age is checked again when it is used.
 */
export default async function NestoLayout({ children }: { children: React.ReactNode }) {
  const startedAt = performance.now();
  const maintenanceCandidate = getPageMaintenanceState();
  maintenanceCandidate.catch(() => undefined);
  const context = await requireUserContext();
  // In parallel; maintenance still wins over a route's own refusal.
  const [maintenance, guard] = await Promise.allSettled([admitPage(maintenanceCandidate), runPreStreamGuard()]);
  if (maintenance.status === "rejected") throw maintenance.reason;
  if (maintenance.value.enabled) redirect("/maintenance");
  if (guard.status === "rejected") throw guard.reason;

  // The offline indicator, the sign-out guard and "Available Offline" are on every page (MOB-09).
  return (
    <ModuleMessages namespaces={["offline"]}>
      <AppShell context={context} startedAt={startedAt}>
        <PasswordChangeNotice userId={context.userId} href="/settings/profile" />
        {children}
      </AppShell>
    </ModuleMessages>
  );
}
