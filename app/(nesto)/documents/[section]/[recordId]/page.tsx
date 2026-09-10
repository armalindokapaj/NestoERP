import { ModuleRecordPage } from "@/components/modules/module-record-page";

export default async function Page({
  params,
}: {
  params: Promise<{ section: string; recordId: string }>;
}) {
  const { section, recordId } = await params;
  return <ModuleRecordPage moduleKey="documents" section={section} recordId={recordId} />;
}
