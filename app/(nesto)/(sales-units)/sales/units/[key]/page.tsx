import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SalesUnitPage, type SalesUnitTab } from "@/components/sales/sales-unit";
import { isUnitStatusView, statusViewHref } from "@/components/sales/sales-units";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  const t = await getTranslations("projects");
  return { title: isUnitStatusView(key) ? t("unitsOverview.title") : t("salesUnit.metaTitle") };
}

/**
 * `/sales/units/<key>`: a unit's sales page — or a status view's old address
 * (for-sale, reserved, sold: the Ribbon's buttons), which now opens the list
 * with that status in its filters. One dynamic segment for both keeps the
 * deployment's route count where it was (Vercel's 2048-route limit,
 * next.config.ts); a unit id is never one of those three words.
 */
export default async function SalesUnitsKeyRoute({ params, searchParams }: Params) {
  const [{ key }, search] = await Promise.all([params, searchParams]);
  if (isUnitStatusView(key)) redirect(statusViewHref(key, search));
  const tab = typeof search.tab === "string" ? (search.tab as SalesUnitTab) : null;
  return <SalesUnitPage unitId={key} tab={tab} />;
}
