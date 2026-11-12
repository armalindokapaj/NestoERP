import type { Metadata } from "next";

import { SalesUnitPage, type SalesUnitTab } from "@/components/sales/sales-unit";
import { isUnitStatusView, SalesUnitsPage } from "@/components/sales/sales-units";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  const t = await getTranslations("projects");
  return { title: isUnitStatusView(key) ? t("unitsOverview.title") : t("salesUnit.metaTitle") };
}

/**
 * `/sales/units/<key>`: a status view — for-sale, reserved, sold — or a unit's
 * sales page. One dynamic segment for both keeps the deployment's route count
 * where it was (Vercel's 2048-route limit, next.config.ts); a unit id is never
 * one of those three words.
 */
export default async function SalesUnitsKeyRoute({ params, searchParams }: Params) {
  const [{ key }, search] = await Promise.all([params, searchParams]);
  if (isUnitStatusView(key)) return <SalesUnitsPage view={key} search={search} />;
  const tab = typeof search.tab === "string" ? (search.tab as SalesUnitTab) : null;
  return <SalesUnitPage unitId={key} tab={tab} />;
}
