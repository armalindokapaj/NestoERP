import type { Metadata } from "next";

import { SalesUnitsPage } from "@/components/sales/sales-units";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitsOverview.title") };
}

/** Every unit across the projects, as Sales sees them (components/sales/sales-units.tsx). */
export default async function SalesUnitsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SalesUnitsPage search={await searchParams} />;
}
