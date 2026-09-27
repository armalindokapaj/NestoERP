import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InspectionForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createInspectionAction } from "@/lib/actions/hse";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import { inspectionTypeLabels } from "@/lib/modules/hse/hse.status";
import { getTranslations } from "@/lib/i18n/server";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.inspections") };
}

/** Raising a safety inspection (PRD #22 §39, §47). */
export default async function NewInspectionPage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.inspection.create")) redirect("/access-denied");

  const options = await inspections.inspectionFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.inspections.title"), href: "/hse/inspections" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.newSafetyInspection")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.inspectionIntro")}
        </p>
      </div>

      <InspectionForm
        action={createInspectionAction}
        cancelHref="/hse/inspections"
        submitLabel={t("page.raiseInspection")}
        pendingLabel={t("page.raising")}
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
          label: `${template.code} — ${template.name} (${hseLabel(t, "inspectionType", template.inspectionType, inspectionTypeLabels[template.inspectionType])}, v${template.version})`,
        }))}
      />
    </div>
  );
}
