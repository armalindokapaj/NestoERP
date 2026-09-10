import type { Metadata } from "next";

import { ModuleSectionPage } from "@/components/modules/module-section-page";
import { modules } from "@/config/modules";

export const metadata: Metadata = { title: modules.contracts.label };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ModuleSectionPage moduleKey="contracts" searchParams={await searchParams} />;
}
