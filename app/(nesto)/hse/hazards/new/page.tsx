import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HazardForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createHazardAction } from "@/lib/actions/hse";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import { companyDays } from "@/lib/core/notifications/company-day";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.hazards") };
}

/**
 * Reporting a hazard (PRD #22 §66, §336).
 *
 * The widest-granted act in the module, and deliberately one page deep from
 * anywhere: a hazard that takes four clicks to report is one that gets reported
 * after the shift instead of during it (PRD #22 §338).
 */
export default async function NewHazardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.hazard.create")) redirect("/access-denied");

  const params = await searchParams;
  const options = await hazards.hazardFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.hazards.title"), href: "/hse/hazards" },
          { label: t("page.crumbReport") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("list.create.hazards")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.hazardIntro")}
        </p>
      </div>

      <HazardForm
        action={createHazardAction}
        cancelHref="/hse/hazards"
        submitLabel={t("page.reportHazard")}
        pendingLabel={t("page.reporting")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        canAssign={can(context, "hse.hazard.assign")}
        values={
          typeof params.projectId === "string"
            ? {
                title: "",
                description: "",
                projectId: params.projectId,
                hazardCategory: "OTHER",
                likelihood: "3",
                severity: "3",
                // Today where the company lives, not the UTC day (AUD-09 §4, FV-07).
                observedAt: (await companyDays(context.companyId))(new Date()).day,
                locationText: "",
                assignedToMemberId: "",
                immediateControl: "",
                controlMeasure: "",
                dueDate: "",
              }
            : undefined
        }
      />
    </div>
  );
}
