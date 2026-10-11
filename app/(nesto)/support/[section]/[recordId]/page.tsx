import type { Metadata } from "next";

import { ModuleRecordPage } from "@/components/modules/module-record-page";
import { getTranslations } from "@/lib/i18n/server";

/** A page title of its own (AUD-11 §3, AV-02), in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("modules");
  return { title: t("support.label") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ section: string; recordId: string }>;
}) {
  const { section, recordId } = await params;
  return <ModuleRecordPage moduleKey="support" section={section} recordId={recordId} />;
}
