import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";

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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("pages.drawings") };
}

/** Drawings and shop drawings with their current revision across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const params = await searchParams;
  const t = await getTranslations("engineering");
  const query = engineeringDocumentListSchema.parse({ ...flat(params), drawings: "1" });
  const result = await listEngineeringDocuments(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/drawings", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="drawings" title={t("pages.drawings")} description={t("pages.drawingsBody")}>
      <div className="space-y-4">
        <ListToolbar searchPlaceholder={t("filters.searchNumberTitle")} searchParam="q" filters={[{ param: "discipline", label: t("filters.discipline"), options: DISCIPLINES.map((value) => ({ value, label: engineeringLabel(t, "discipline", value, DISCIPLINE_LABELS[value]) })) }, { param: "status", label: t("filters.status"), options: DOCUMENT_STATUSES.map((value) => ({ value, label: engineeringLabel(t, "reviewStatus", value, REVIEW_STATUS_LABELS[value]) })) }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "discipline", "status"]) ? (
          <NoResultsState noun={t("nouns.drawings")} clearHref="/engineering/drawings" />
        ) : (
          <DocumentRegister items={result.items} showProject drawings />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/drawings", params, page)} />
      </div>
    </ModulePage>
  );
}
