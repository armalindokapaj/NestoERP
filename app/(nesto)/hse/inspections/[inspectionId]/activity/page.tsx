import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseActivityFeed } from "@/components/hse/record-activity";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pageHref, paginationSchema } from "@/lib/modules/shared/list-query";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";

export const metadata: Metadata = { title: "Inspection activity" };

type Params = {
  params: Promise<{ inspectionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InspectionActivityPage({ params, searchParams }: Params) {
  const { inspectionId } = await params;
  const query = await searchParams;
  const { page } = paginationSchema.parse({ page: typeof query.page === "string" ? query.page : undefined });
  const basePath = `/hse/inspections/${inspectionId}/activity`;
  const context = await requireModule("hse");

  let inspection;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!inspection.capabilities.canViewActivity) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Inspections", href: "/hse/inspections" },
          { label: inspection.inspectionNumber, href: `/hse/inspections/${inspectionId}` },
          { label: "Activity" },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">
        Activity on {inspection.inspectionNumber}
      </h1>

      <HseActivityFeed
        context={context}
        entityType="HseInspection"
        entityId={inspection.id}
        page={page}
        buildHref={(target) => pageHref(basePath, query, target)}
      />
    </div>
  );
}
