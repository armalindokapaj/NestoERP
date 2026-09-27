import type { Metadata } from "next";

import { ModuleSectionPage } from "@/components/modules/module-section-page";
import { modules } from "@/config/modules";

/** A page title of its own (AUD-11 §3, AV-02). */
export const metadata: Metadata = { title: modules.support.label };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  return (
    <ModuleSectionPage
      moduleKey="support"
      section={section}
      searchParams={await searchParams}
    />
  );
}
