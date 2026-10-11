import type { Metadata } from "next";

import { ModuleSectionPage } from "@/components/modules/module-section-page";
import { getTranslations } from "@/lib/i18n/server";

/** A page title of its own (AUD-11 §3, AV-02), in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("modules");
  return { title: t("support.label") };
}

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
