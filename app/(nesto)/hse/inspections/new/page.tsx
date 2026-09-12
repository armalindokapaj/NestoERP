import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InspectionForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createInspectionAction } from "@/lib/actions/hse";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import { inspectionTypeLabels } from "@/lib/modules/hse/hse.status";

export const metadata: Metadata = { title: "New inspection" };

/** Raising a safety inspection (PRD #22 §39, §47). */
export default async function NewInspectionPage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.inspection.create")) redirect("/access-denied");

  const options = await inspections.inspectionFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Inspections", href: "/hse/inspections" },
          { label: "New" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New safety inspection</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Pick a checklist and it is copied onto this inspection. Editing the checklist later will not change what was answered here.
        </p>
      </div>

      <InspectionForm
        action={createInspectionAction}
        cancelHref="/hse/inspections"
        submitLabel="Raise inspection"
        pendingLabel="Raising…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        templates={options.templates.map((template) => ({
          value: template.id,
          label: `${template.code} — ${template.name} (${inspectionTypeLabels[template.inspectionType]}, v${template.version})`,
        }))}
      />
    </div>
  );
}
