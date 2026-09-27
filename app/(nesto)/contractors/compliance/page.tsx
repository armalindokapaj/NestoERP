import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CompliancePanel } from "@/components/contractors/contractor-panels";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { complianceListSchema } from "@/lib/modules/contractors/contractor.schema";
import { COMPLIANCE_STATUSES, COMPLIANCE_STATUS_LABELS, COMPLIANCE_TYPES, COMPLIANCE_TYPE_LABELS } from "@/lib/modules/contractors/contractor.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.compliance") };
}

/** Every contractor's insurance, licences and guarantees, soonest expiry first (PRD #46 §41-§49, §207). */
export default async function CompliancePage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("contractors");
  if (!contractorsOpen(context, "contractor_compliance.view")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "contractors");
  const params = await searchParams;
  const t = await getTranslations("contractors");
  const query = complianceListSchema.parse(flat(params));
  const result = await listCompliance(context, query);
  // The register pages with a true count instead of stopping silently at 50 (AUD-08 §4, DT-05).
  keepPageInRange("/contractors/compliance", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="compliance" description={t("compliancePage.description")}>
      <div className="space-y-4">
        <ListToolbar
          searchPlaceholder={t("compliancePage.search")}
          searchParam="q"
          filters={[
            { param: "alerts", label: t("compliancePage.alerts"), options: [{ value: "1", label: t("compliancePage.alertsOption") }] },
            { param: "status", label: t("compliancePage.status"), options: COMPLIANCE_STATUSES.map((value) => ({ value, label: contractorsLabel(t, "complianceStatus", value, COMPLIANCE_STATUS_LABELS[value]) })) },
            { param: "type", label: t("compliancePage.type"), options: COMPLIANCE_TYPES.map((value) => ({ value, label: contractorsLabel(t, "complianceType", value, COMPLIANCE_TYPE_LABELS[value]) })) },
          ]}
        />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "alerts", "status", "type"]) ? (
          <NoResultsState noun={t("compliancePage.noun")} clearHref="/contractors/compliance" />
        ) : (
          <CompliancePanel contractorId={null} items={result.items} canManage={false} canUpload={false} showContractor />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/contractors/compliance", params, page)} />
      </div>
    </ModulePage>
  );
}
