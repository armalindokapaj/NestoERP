import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { IncidentForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateIncidentAction } from "@/lib/actions/hse";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import { companyZone, instantToWallClock } from "@/lib/modules/hse/hse.time";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editIncident") };
}

type Params = { params: Promise<{ incidentId: string }> };

export default async function EditIncidentPage({ params }: Params) {
  const { incidentId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.incident.update")) notFound();

  let incident;
  try {
    incident = await incidents.getIncident(context, incidentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!incident.capabilities.canEdit) notFound();

  const options = await incidents.incidentFormOptions(context);
  const zone = await companyZone(context.companyId);
  const update = updateIncidentAction.bind(null, incidentId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.incidents.title"), href: "/hse/incidents" },
          { label: incident.incidentNumber, href: `/hse/incidents/${incidentId}` },
          { label: t("template.detail.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.editNumber", { number: incident.incidentNumber })}</h1>
      </div>

      <IncidentForm
        action={update}
        cancelHref={`/hse/incidents/${incidentId}`}
        submitLabel={t("page.saveIncident")}
        pendingLabel={t("page.saving")}
        versionUpdatedAt={incident.updatedAt}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        values={{
          incidentType: incident.incidentType,
          title: incident.title,
          description: incident.description,
          projectId: incident.project?.id ?? "",
          // The company's wall clock, as the form sends it back (AUD-09 §4, FV-07).
          occurredAt: instantToWallClock(incident.occurredAt, zone),
          locationText: incident.locationText ?? "",
          severity: incident.severity,
          injuryOccurred: incident.injury?.injuryOccurred ?? false,
          firstAidRequired: incident.injury?.firstAidRequired ?? false,
          medicalTreatmentRequired: incident.injury?.medicalTreatmentRequired ?? false,
          lostTime: incident.injury?.lostTime ?? false,
          propertyDamage: incident.injury?.propertyDamage ?? false,
          environmentalImpact: incident.injury?.environmentalImpact ?? false,
          immediateAction: incident.immediateAction ?? "",
          dueDate: incident.dueDate?.slice(0, 10) ?? "",
        }}
      />
    </div>
  );
}
