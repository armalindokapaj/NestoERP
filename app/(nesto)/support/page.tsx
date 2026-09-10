import type { Metadata } from "next";

import { ModuleSectionPage } from "@/components/modules/module-section-page";
import { modules } from "@/config/modules";

export const metadata: Metadata = { title: modules.support.label };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ModuleSectionPage moduleKey="support" searchParams={await searchParams} />;
}
