import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { DocumentRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listEngineeringDocuments } from "@/lib/modules/engineering/engineering.documents";
import { engineeringDocumentListSchema } from "@/lib/modules/engineering/engineering.schema";
import { DISCIPLINES, DISCIPLINE_LABELS, DOCUMENT_STATUSES, REVIEW_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";

export const metadata: Metadata = { title: "Drawings" };

/** Drawings and shop drawings with their current revision across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const params = await searchParams;
  const query = engineeringDocumentListSchema.parse({ ...flat(params), drawings: "1" });
  const result = await listEngineeringDocuments(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/drawings", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="drawings" title="Drawings" description="Drawings and shop drawings with their current revision across your projects.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search number or title…" searchParam="q" filters={[{ param: "discipline", label: "Discipline", options: DISCIPLINES.map((value) => ({ value, label: DISCIPLINE_LABELS[value] })) }, { param: "status", label: "Status", options: DOCUMENT_STATUSES.map((value) => ({ value, label: REVIEW_STATUS_LABELS[value] })) }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "discipline", "status"]) ? (
          <NoResultsState noun="drawings" clearHref="/engineering/drawings" />
        ) : (
          <DocumentRegister items={result.items} showProject drawings />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/drawings", params, page)} />
      </div>
    </ModulePage>
  );
}
