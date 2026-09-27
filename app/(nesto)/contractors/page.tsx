import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";

import { NewContractorButton } from "@/components/contractors/contractor-dialogs";
import { ContractorTable } from "@/components/contractors/contractor-tables";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { contractorListSchema } from "@/lib/modules/contractors/contractor.schema";
import { listContractors } from "@/lib/modules/contractors/contractor.service";
import { CONTRACTOR_STATUSES, CONTRACTOR_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.contractors") };
}

/** The contractor directory (PRD #46 §163): status, active projects, open RFIs, submittals and compliance alerts. */
export default async function ContractorsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("contractors");
  const experience = resolveModuleExperience(context, "contractors");
  const params = await searchParams;
  const t = await getTranslations("contractors");
  const query = contractorListSchema.parse(flat(params));
  const result = await listContractors(context, query);
  // A count on every page and the last real page for a page past the end (AUD-08 §4, DT-05).
  keepPageInRange("/contractors", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="all" actions={can(context, "contractor.create") ? <NewContractorButton /> : null}>
      <div className="space-y-4">
        <ListToolbar
          searchPlaceholder={t("directory.search")}
          searchParam="q"
          filters={[
            { param: "status", label: t("directory.status"), options: CONTRACTOR_STATUSES.map((value) => ({ value, label: contractorsLabel(t, "contractorStatus", value, CONTRACTOR_STATUS_LABELS[value]) })) },
            { param: "compliance", label: t("directory.compliance"), options: [{ value: "alerts", label: t("directory.withAlerts") }] },
          ]}
        />
        {/* Filters that match nothing are not an empty directory (AUD-05 §6, UX-11). */}
        {result.items.length === 0 && hasActiveFilters(params, ["q", "status", "compliance"]) ? (
          <NoResultsState noun={t("directory.noun")} clearHref="/contractors" />
        ) : (
          <ContractorTable items={result.items} canCreate={can(context, "contractor.create")} />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/contractors", params, page)} />
      </div>
    </ModulePage>
  );
}
