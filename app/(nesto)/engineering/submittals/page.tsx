import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";

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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("pages.submittals") };
}

/** Submittals, method statements and material submittals across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const params = await searchParams;
  const t = await getTranslations("engineering");
  const query = submittalListSchema.parse({ ...flat(params) });
  const result = await listSubmittals(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/submittals", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="submittals" title={t("pages.submittals")} description={t("pages.submittalsBody")}>
      <div className="space-y-4">
        {/* English: "Search number, title or product…" (AUD-05 §5). */}
        <ListToolbar searchPlaceholder={t("filters.searchSubmittal")} searchParam="q" filters={[{ param: "status", label: t("filters.status"), options: SUBMITTAL_STATUSES.map((value) => ({ value, label: engineeringLabel(t, "reviewStatus", value, REVIEW_STATUS_LABELS[value]) })) }, { param: "type", label: t("filters.type"), options: SUBMITTAL_TYPES.map((value) => ({ value, label: engineeringLabel(t, "submittalType", value, SUBMITTAL_TYPE_LABELS[value]) })) }, { param: "reviewer", label: t("filters.reviewer"), options: [{ value: "me", label: t("filters.assignedToMe") }] }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "status", "type", "reviewer"]) ? (
          <NoResultsState noun={t("nouns.submittals")} clearHref="/engineering/submittals" />
        ) : (
          <SubmittalRegister items={result.items} showProject />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/submittals", params, page)} />
      </div>
    </ModulePage>
  );
}
