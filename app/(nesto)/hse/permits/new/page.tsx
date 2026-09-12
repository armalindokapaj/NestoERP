import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PermitForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createPermitAction } from "@/lib/actions/hse";
import * as permits from "@/lib/modules/hse/permits/permit.service";

export const metadata: Metadata = { title: "New work permit" };

/** Requesting authorisation for controlled work (PRD #22 §145). */
export default async function NewPermitPage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.permit.create")) notFound();

  const options = await permits.permitFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Permits", href: "/hse/permits" },
          { label: "New" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New work permit</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Specific work, in a specific place, for a fixed window. Somebody other than you approves
          it before it authorises anything.
        </p>
      </div>

      <PermitForm
        action={createPermitAction}
        cancelHref="/hse/permits"
        submitLabel="Raise permit"
        pendingLabel="Raising…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        assessments={options.assessments.map((assessment) => ({
          value: assessment.id,
          label: `${assessment.assessmentNumber} v${assessment.version} — ${assessment.title}`,
        }))}
      />
    </div>
  );
}
