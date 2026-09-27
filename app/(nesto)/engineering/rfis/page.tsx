import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";

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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("pages.rfis") };
}

/** Requests for information across every project you can open. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const params = await searchParams;
  const t = await getTranslations("engineering");
  const query = rfiListSchema.parse({ ...flat(params) });
  const result = await listRfis(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/rfis", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="rfis" title={t("pages.rfis")} description={t("pages.rfisBody")}>
      <div className="space-y-4">
        {/* English: "Search RFI number or subject…" (AUD-05 §5). */}
        <ListToolbar searchPlaceholder={t("filters.searchRfi")} searchParam="q" filters={[{ param: "status", label: t("filters.status"), options: RFI_STATUSES.map((value) => ({ value, label: engineeringLabel(t, "rfiStatus", value, RFI_STATUS_LABELS[value]) })) }, { param: "assignee", label: t("filters.assignee"), options: [{ value: "me", label: t("filters.assignedToMe") }] }, { param: "overdue", label: t("filters.due"), options: [{ value: "1", label: t("filters.overdue") }] }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "status", "assignee", "overdue"]) ? (
          <NoResultsState noun={t("nouns.rfis")} clearHref="/engineering/rfis" />
        ) : (
          <RfiRegister items={result.items} showProject />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/rfis", params, page)} />
      </div>
    </ModulePage>
  );
}
