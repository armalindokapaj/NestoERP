import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RiskAssessmentForm } from "@/components/hse/risk-assessment-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createRiskAssessmentAction } from "@/lib/actions/hse";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.risk-assessments") };
}

/** A structured look at one activity (PRD #22 §106). */
export default async function NewRiskAssessmentPage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.risk.create")) notFound();

  const options = await risk.riskFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.riskAssessments.title"), href: "/hse/risk-assessments" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("list.create.risk-assessments")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.riskIntro")}
        </p>
      </div>

      <RiskAssessmentForm
        action={createRiskAssessmentAction}
        cancelHref="/hse/risk-assessments"
        submitLabel={t("page.createAssessment")}
        pendingLabel={t("page.creating")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
      />
    </div>
  );
}
