import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IncidentForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createIncidentAction } from "@/lib/actions/hse";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.incidents") };
}

/** Reporting an incident or a near miss (PRD #22 §83, §337). */
export default async function NewIncidentPage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.incident.create")) redirect("/access-denied");

  const options = await incidents.incidentFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.incidents.title"), href: "/hse/incidents" },
          { label: t("page.crumbReport") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("list.create.incidents")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.incidentIntro")}
        </p>
      </div>

      <IncidentForm
        action={createIncidentAction}
        cancelHref="/hse/incidents"
        submitLabel={t("page.reportIncident")}
        pendingLabel={t("page.reporting")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
      />
    </div>
  );
}
