import type { Metadata } from "next";

import { UnitsOverviewPage, unitStatusView } from "@/components/projects/units-overview";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitsOverview.title") };
}

/** The units in one sales status — For sale, Reserved, Sold — across the projects (components/projects/units-overview.tsx). */
export default async function UnitsStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ status: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ status }, search] = await Promise.all([params, searchParams]);
  return <UnitsOverviewPage view={unitStatusView(status)} search={search} />;
}
