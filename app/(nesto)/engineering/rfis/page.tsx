import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { RfiRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { rfiListSchema } from "@/lib/modules/engineering/engineering.schema";
import { RFI_STATUSES, RFI_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";

export const metadata: Metadata = { title: "RFIs" };

/** Requests for information across every project you can open. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const params = await searchParams;
  const query = rfiListSchema.parse({ ...flat(params) });
  const result = await listRfis(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/rfis", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="rfis" title="RFIs" description="Requests for information across every project you can open.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search RFI number or subject…" searchParam="q" filters={[{ param: "status", label: "Status", options: RFI_STATUSES.map((value) => ({ value, label: RFI_STATUS_LABELS[value] })) }, { param: "assignee", label: "Assignee", options: [{ value: "me", label: "Assigned to me" }] }, { param: "overdue", label: "Due", options: [{ value: "1", label: "Overdue" }] }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "status", "assignee", "overdue"]) ? (
          <NoResultsState noun="RFIs" clearHref="/engineering/rfis" />
        ) : (
          <RfiRegister items={result.items} showProject />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/rfis", params, page)} />
      </div>
    </ModulePage>
  );
}
