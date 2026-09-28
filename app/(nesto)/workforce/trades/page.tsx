import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { TradesManager } from "@/components/workforce/trades-manager";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { listTrades } from "@/lib/modules/workforce/trade.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("workforce"))("meta.trades") };
}

/** The company's trades (E-04 §11). Somebody without the grant is told nothing is here. */
export default async function TradesPage() {
  const context = await requireModule("workforce");
  if (!can(context, "workforce.trade.manage")) notFound();
  const trades = await listTrades(context);
  const t = await getTranslations("workforce");
  return (
    <ModulePage
      experience={resolveModuleExperience(context, "workforce")}
      activeSection="trades"
      description={t("trades.description", { company: context.company.name })}
    >
      <TradesManager initial={trades} />
    </ModulePage>
  );
}
