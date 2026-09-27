import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseActivityFeed } from "@/components/hse/record-activity";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pageHref, paginationSchema } from "@/lib/modules/shared/list-query";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";

export const metadata: Metadata = { title: "Incident activity" };

type Params = {
  params: Promise<{ incidentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IncidentActivityPage({ params, searchParams }: Params) {
  const { incidentId } = await params;
  const query = await searchParams;
  const { page } = paginationSchema.parse({ page: typeof query.page === "string" ? query.page : undefined });
  const basePath = `/hse/incidents/${incidentId}/activity`;
  const context = await requireModule("hse");

  let incident;
  try {
    incident = await incidents.getIncident(context, incidentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!incident.capabilities.canViewActivity) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Incidents", href: "/hse/incidents" },
          { label: incident.incidentNumber, href: `/hse/incidents/${incidentId}` },
          { label: "Activity" },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">Activity on {incident.incidentNumber}</h1>

      <HseActivityFeed
        context={context}
        entityType="HseIncident"
        entityId={incident.id}
        page={page}
        buildHref={(target) => pageHref(basePath, query, target)}
      />
    </div>
  );
}
