import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pageHref, paginationSchema } from "@/lib/modules/shared/list-query";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export const metadata: Metadata = { title: "Activity" };

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
          { label: "QA/QC", href: "/qaqc" },
          { label: "NCRs", href: "/qaqc/ncrs" },
          { label: ncr.ncrNumber, href: `/qaqc/ncrs/${ncr.id}` },
          { label: "Activity" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Activity</h1>
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
