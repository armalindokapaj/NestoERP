import type { Metadata } from "next";

import { UnitsOverviewPage } from "@/components/projects/units-overview";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitsOverview.title") };
}

/** Every unit across the projects (components/projects/units-overview.tsx). */
export default async function UnitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <UnitsOverviewPage view={null} search={await searchParams} />;
}
