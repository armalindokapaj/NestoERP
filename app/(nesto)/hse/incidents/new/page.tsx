import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IncidentForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createIncidentAction } from "@/lib/actions/hse";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";

export const metadata: Metadata = { title: "Report an incident" };

/** Reporting an incident or a near miss (PRD #22 §83, §337). */
export default async function NewIncidentPage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.incident.create")) redirect("/access-denied");

  const options = await incidents.incidentFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Incidents", href: "/hse/incidents" },
          { label: "Report" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Report an incident</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Something that happened, or nearly did. A near miss goes here too — it is the same record.
        </p>
      </div>

      <IncidentForm
        action={createIncidentAction}
        cancelHref="/hse/incidents"
        submitLabel="Report incident"
        pendingLabel="Reporting…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
      />
    </div>
  );
}
