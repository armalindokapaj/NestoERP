import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CompliancePanel } from "@/components/contractors/contractor-panels";
import { one, orNotFound, type SearchParams } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { listContractorCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { getContractor } from "@/lib/modules/contractors/contractor.service";

type Params = { params: Promise<{ contractorId: string }>; searchParams: SearchParams };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.compliance") };
}

/** The contractor's compliance, with renewal, evidence upload and waiver (PRD #46 §41-§49, §312). */
export default async function ContractorCompliancePage({ params, searchParams }: Params) {
  const [{ contractorId }, search] = await Promise.all([params, searchParams]);
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  if (!contractor.capabilities.canViewCompliance) redirect("/access-denied");
  const items = await listContractorCompliance(context, contractor.id);
  return <CompliancePanel contractorId={contractor.id} items={items} canManage={contractor.capabilities.canManageCompliance} canUpload={contractor.capabilities.canUploadDocuments || contractor.capabilities.canManageCompliance} highlight={one(search.item) ?? null} />;
}
