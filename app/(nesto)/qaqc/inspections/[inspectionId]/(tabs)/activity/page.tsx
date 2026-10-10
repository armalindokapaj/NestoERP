import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";

import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { pageHref, paginationSchema } from "@/lib/modules/shared/list-query";
import { loadInspectionPage } from "../../inspection-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.activity") };
}

type Params = {
  params: Promise<{ inspectionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** One inspection's history (PRD #21 §186). */
export default async function InspectionActivityPage({ params, searchParams }: Params) {
  const { inspectionId } = await params;
  const query = await searchParams;
  const { page } = paginationSchema.parse({ page: typeof query.page === "string" ? query.page : undefined });
  const basePath = `/qaqc/inspections/${inspectionId}/activity`;
  const { context, inspection } = await loadInspectionPage(inspectionId, "activity");

  return (
    <>
      <QaqcActivityFeed
        context={context}
        entityType="QualityInspection"
        entityId={inspection.id}
        page={page}
        buildHref={(target) => pageHref(basePath, query, target)}
      />
    </>
  );
}
