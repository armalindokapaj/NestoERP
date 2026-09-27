import type { Metadata } from "next";

import { ModuleRecordPage } from "@/components/modules/module-record-page";
import { modules } from "@/config/modules";

/** A page title of its own (AUD-11 §3, AV-02). */
export const metadata: Metadata = { title: modules.support.label };

export default async function Page({
  params,
}: {
  params: Promise<{ section: string; recordId: string }>;
}) {
  const { section, recordId } = await params;
  return <ModuleRecordPage moduleKey="support" section={section} recordId={recordId} />;
}
