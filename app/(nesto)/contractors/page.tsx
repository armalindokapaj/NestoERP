import type { Metadata } from "next";

import { NewContractorButton } from "@/components/contractors/contractor-dialogs";
import { ContractorTable } from "@/components/contractors/contractor-tables";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { contractorListSchema } from "@/lib/modules/contractors/contractor.schema";
import { listContractors } from "@/lib/modules/contractors/contractor.service";
import { CONTRACTOR_STATUSES, CONTRACTOR_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";

export const metadata: Metadata = { title: "Contractors" };

/** The contractor directory (PRD #46 §163): status, active projects, open RFIs, submittals and compliance alerts. */
export default async function ContractorsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("contractors");
  const experience = resolveModuleExperience(context, "contractors");
  const params = await searchParams;
  const query = contractorListSchema.parse(flat(params));
  const result = await listContractors(context, query);
  // A count on every page and the last real page for a page past the end (AUD-08 §4, DT-05).
  keepPageInRange("/contractors", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="all" actions={can(context, "contractor.create") ? <NewContractorButton /> : null}>
      <div className="space-y-4">
        <ListToolbar
          searchPlaceholder="Search name, registration or VAT number…"
          searchParam="q"
          filters={[
            { param: "status", label: "Status", options: CONTRACTOR_STATUSES.map((value) => ({ value, label: CONTRACTOR_STATUS_LABELS[value] })) },
            { param: "compliance", label: "Compliance", options: [{ value: "alerts", label: "With alerts" }] },
          ]}
        />
        <ContractorTable items={result.items} />
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/contractors", params, page)} />
      </div>
    </ModulePage>
  );
}
