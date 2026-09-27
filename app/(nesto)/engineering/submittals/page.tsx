import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { SubmittalRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listSubmittals } from "@/lib/modules/engineering/engineering.submittals";
import { submittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { REVIEW_STATUS_LABELS, SUBMITTAL_STATUSES, SUBMITTAL_TYPES, SUBMITTAL_TYPE_LABELS } from "@/lib/modules/engineering/engineering.types";

export const metadata: Metadata = { title: "Submittals" };

/** Submittals, method statements and material submittals across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const params = await searchParams;
  const query = submittalListSchema.parse({ ...flat(params) });
  const result = await listSubmittals(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/submittals", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="submittals" title="Submittals" description="Submittals, method statements and material submittals across your projects.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search number, title or product…" searchParam="q" filters={[{ param: "status", label: "Status", options: SUBMITTAL_STATUSES.map((value) => ({ value, label: REVIEW_STATUS_LABELS[value] })) }, { param: "type", label: "Type", options: SUBMITTAL_TYPES.map((value) => ({ value, label: SUBMITTAL_TYPE_LABELS[value] })) }, { param: "reviewer", label: "Reviewer", options: [{ value: "me", label: "Assigned to me" }] }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "status", "type", "reviewer"]) ? (
          <NoResultsState noun="submittals" clearHref="/engineering/submittals" />
        ) : (
          <SubmittalRegister items={result.items} showProject />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/submittals", params, page)} />
      </div>
    </ModulePage>
  );
}
