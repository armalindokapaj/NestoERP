import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FinanceSettingsForm } from "@/components/finance/settings-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getFinanceSettings } from "@/lib/modules/finance/finance.settings";

export const metadata: Metadata = { title: "Finance settings" };

/**
 * Company finance configuration (PRD #15 §394, §395).
 *
 * Base currency, default payment terms, fiscal year start and the default tax
 * rate. Changing the base currency does not convert anything — V0.1 has no FX
 * engine, so existing records keep the currency they were recorded in.
 */
export default async function FinanceSettingsPage() {
  const context = await requireModule("finance");

  if (!can(context, "finance.settings.view")) redirect("/access-denied");

  const settings = await getFinanceSettings(context);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Settings" }]}
        title="Finance settings"
        subtitle="Defaults for new records across the Finance module."
      />

      <FinanceSettingsForm
        settings={settings}
        canManage={can(context, "finance.settings.manage")}
      />
    </div>
  );
}
