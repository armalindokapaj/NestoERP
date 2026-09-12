import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RiskAssessmentForm } from "@/components/hse/risk-assessment-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createRiskAssessmentAction } from "@/lib/actions/hse";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";

export const metadata: Metadata = { title: "New risk assessment" };

/** A structured look at one activity (PRD #22 §106). */
export default async function NewRiskAssessmentPage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.risk.create")) notFound();

  const options = await risk.riskFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Risk assessments", href: "/hse/risk-assessments" },
          { label: "New" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New risk assessment</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          One line per hazard: what could hurt somebody, what already controls it, and what will
          be left once the extra controls go in.
        </p>
      </div>

      <RiskAssessmentForm
        action={createRiskAssessmentAction}
        cancelHref="/hse/risk-assessments"
        submitLabel="Create assessment"
        pendingLabel="Creating…"
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
