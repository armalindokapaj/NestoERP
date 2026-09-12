import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ObservationForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createObservationAction } from "@/lib/actions/hse";
import * as environment from "@/lib/modules/hse/environment/environment.service";

export const metadata: Metadata = { title: "Report an observation" };

/** Reporting an environmental observation (PRD #22 §163). */
export default async function NewObservationPage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.environment.create")) notFound();

  const options = await environment.observationFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Environment", href: "/hse/environment" },
          { label: "Report" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Report an environmental observation</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          A spill, dust, noise, waste going astray. NESTO files nothing with a regulator — this is
          the company&rsquo;s own record.
        </p>
      </div>

      <ObservationForm
        action={createObservationAction}
        cancelHref="/hse/environment"
        submitLabel="Report observation"
        pendingLabel="Reporting…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        canAssign={can(context, "hse.environment.update")}
      />
    </div>
  );
}
