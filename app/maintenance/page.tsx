import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { Card } from "@/components/ui/card";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata() {
  return { title: (await getTranslations("misc"))("maintenance.metaTitle") };
}

export default async function MaintenancePage() {
  const state = await getMaintenanceState();
  if (!state.enabled) redirect("/dashboard");
  const m = await getTranslations("misc");
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-12">
      <Card className="w-full max-w-lg p-8 text-center">
        <div className="mx-auto mb-6 flex justify-center"><NestoLogo /></div>
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-warning-soft text-warning-strong"><Wrench className="size-6" aria-hidden="true" /></span>
        <h1 className="text-title font-semibold text-fg">{m("maintenance.title")}</h1>
        <p className="mx-auto mt-3 max-w-md text-body text-fg-muted">{state.reason || m("maintenance.body")}</p>
      </Card>
    </main>
  );
}
