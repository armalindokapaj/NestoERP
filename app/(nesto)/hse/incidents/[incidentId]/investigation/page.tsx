import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InvestigationForm } from "@/components/hse/investigation-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";

export const metadata: Metadata = { title: "Investigation" };

type Params = { params: Promise<{ incidentId: string }> };

/**
 * Recording what the investigation found (PRD #22 §88, §90, §91).
 *
 * A serious incident cannot close without a root cause. That is the whole point
 * of investigating one (PRD #22 §363).
 */
export default async function IncidentInvestigationPage({ params }: Params) {
  const { incidentId } = await params;
  const context = await requireModule("hse");
  if (!can(context, "hse.incident.investigate")) notFound();

  let incident;
  try {
    incident = await incidents.getIncident(context, incidentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!incident.capabilities.canInvestigate) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Incidents", href: "/hse/incidents" },
          { label: incident.incidentNumber, href: `/hse/incidents/${incidentId}` },
          { label: "Investigation" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">
          Investigating {incident.incidentNumber}
        </h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {incident.severity === "HIGH" || incident.severity === "CRITICAL"
            ? "A high or critical incident cannot close without a root cause. “Operative was careless” is not one."
            : "What happened, why, and what the company takes from it."}
        </p>
      </div>

      <InvestigationForm incident={incident} />
    </div>
  );
}
