import type { Metadata } from "next";

import { ModuleSectionPage } from "@/components/modules/module-section-page";
import { getTranslations } from "@/lib/i18n/server";

/** The module's name as the sidebar shows it, in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("modules");
  return { title: t("support.label") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ModuleSectionPage moduleKey="support" searchParams={await searchParams} />;
}
