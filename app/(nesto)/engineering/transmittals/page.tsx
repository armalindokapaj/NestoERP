import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { TransmittalRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listTransmittals } from "@/lib/modules/engineering/engineering.transmittals";
import { transmittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { TRANSMITTAL_STATUSES, TRANSMITTAL_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("pages.transmittals") };
}

/** Formal issues of documents across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const params = await searchParams;
  const t = await getTranslations("engineering");
  const query = transmittalListSchema.parse({ ...flat(params) });
  const result = await listTransmittals(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/transmittals", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="transmittals" title={t("pages.transmittals")} description={t("pages.transmittalsBody")}>
      <div className="space-y-4">
        {/* English: "Search number, subject, recipient or document number…" (AUD-05 §5). */}
        <ListToolbar searchPlaceholder={t("filters.searchTransmittal")} searchParam="q" filters={[{ param: "status", label: t("filters.status"), options: TRANSMITTAL_STATUSES.map((value) => ({ value, label: engineeringLabel(t, "transmittalStatus", value, TRANSMITTAL_STATUS_LABELS[value]) })) }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "status"]) ? (
          <NoResultsState noun={t("nouns.transmittals")} clearHref="/engineering/transmittals" />
        ) : (
          <TransmittalRegister items={result.items} showProject />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/transmittals", params, page)} />
      </div>
    </ModulePage>
  );
}
