import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FinanceSettingsForm } from "@/components/finance/settings-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { getFinanceSettings } from "@/lib/modules/finance/finance.settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.settings") };
}

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
  const t = await getTranslations("finance");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[{ label: t("crumbs.finance"), href: "/finance" }, { label: t("settings.crumb") }]}
        title={t("settings.label")}
        subtitle={t("settings.subtitle")}
      />

      <FinanceSettingsForm
        settings={settings}
        canManage={can(context, "finance.settings.manage")}
      />
    </div>
  );
}
