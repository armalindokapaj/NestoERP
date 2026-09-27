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

export const metadata: Metadata = { title: "Contractor compliance" };

/** Every contractor's insurance, licences and guarantees, soonest expiry first (PRD #46 §41-§49, §207). */
export default async function CompliancePage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("contractors");
  if (!contractorsOpen(context, "contractor_compliance.view")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "contractors");
  const params = await searchParams;
  const query = complianceListSchema.parse(flat(params));
  const result = await listCompliance(context, query);
  // The register pages with a true count instead of stopping silently at 50 (AUD-08 §4, DT-05).
  keepPageInRange("/contractors/compliance", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="compliance" description="Insurance, licences, guarantees and certificates across contractors — soonest expiry first.">
      <div className="space-y-4">
        <ListToolbar
          searchPlaceholder="Search requirement, reference or contractor…"
          searchParam="q"
          filters={[
            { param: "alerts", label: "Alerts", options: [{ value: "1", label: "Expiring, expired or missing" }] },
            { param: "status", label: "Status", options: COMPLIANCE_STATUSES.map((value) => ({ value, label: COMPLIANCE_STATUS_LABELS[value] })) },
            { param: "type", label: "Type", options: COMPLIANCE_TYPES.map((value) => ({ value, label: COMPLIANCE_TYPE_LABELS[value] })) },
          ]}
        />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "alerts", "status", "type"]) ? (
          <NoResultsState noun="compliance records" clearHref="/contractors/compliance" />
        ) : (
          <CompliancePanel contractorId={null} items={result.items} canManage={false} canUpload={false} showContractor />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/contractors/compliance", params, page)} />
      </div>
    </ModulePage>
  );
}
