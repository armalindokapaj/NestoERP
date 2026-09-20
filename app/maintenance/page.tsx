import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { Card } from "@/components/ui/card";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";

export const metadata = { title: "Maintenance · NESTO" };

export default async function MaintenancePage() {
  const state = await getMaintenanceState();
  if (!state.enabled) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-12">
      <Card className="w-full max-w-lg p-8 text-center">
        <div className="mx-auto mb-6 flex justify-center"><NestoLogo /></div>
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-warning-soft text-warning-strong"><Wrench className="size-6" aria-hidden="true" /></span>
        <h1 className="text-title font-semibold text-fg">NESTO is under maintenance</h1>
        <p className="mx-auto mt-3 max-w-md text-body text-fg-muted">{state.reason || "The platform team is completing scheduled maintenance. Your data is safe; tenant access will return when the work is complete."}</p>
      </Card>
    </main>
  );
}
