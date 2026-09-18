import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { TradesManager } from "@/components/workforce/trades-manager";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listTrades } from "@/lib/modules/workforce/trade.service";

export const metadata: Metadata = { title: "Trades" };

/** The company's trades (E-04 §11). Somebody without the grant is told nothing is here. */
export default async function TradesPage() {
  const context = await requireModule("workforce");
  if (!can(context, "workforce.trade.manage")) notFound();
  const trades = await listTrades(context);
  return (
    <ModulePage
      experience={resolveModuleExperience(context, "workforce")}
      activeSection="trades"
      description={`The trades ${context.company.name} records its workers under. A trade is the job, never a NESTO role: somebody without a login has one too.`}
    >
      <TradesManager initial={trades} />
    </ModulePage>
  );
}
