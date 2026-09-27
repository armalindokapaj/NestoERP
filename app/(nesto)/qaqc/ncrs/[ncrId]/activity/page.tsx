import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pageHref, paginationSchema } from "@/lib/modules/shared/list-query";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.activity") };
}

type Params = {
  params: Promise<{ ncrId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** One NCR's history (PRD #21 §186). */
export default async function NcrActivityPage({ params, searchParams }: Params) {
  const { ncrId } = await params;
  const query = await searchParams;
  const { page } = paginationSchema.parse({ page: typeof query.page === "string" ? query.page : undefined });
  const basePath = `/qaqc/ncrs/${ncrId}/activity`;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let ncr;
  try {
    ncr = await ncrs.getNcr(context, ncrId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!ncr.capabilities.canViewActivity) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.ncrs"), href: "/qaqc/ncrs" },
          { label: ncr.ncrNumber, href: `/qaqc/ncrs/${ncr.id}` },
          { label: t("crumbs.activity") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("detail.activity")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{ncr.ncrNumber}</p>
      </div>

      <QaqcActivityFeed
        context={context}
        entityType="NonConformanceReport"
        entityId={ncr.id}
        page={page}
        buildHref={(target) => pageHref(basePath, query, target)}
      />
    </div>
  );
}
