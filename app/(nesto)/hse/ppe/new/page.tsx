import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PpeForm } from "@/components/hse/ppe-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createPpeCheckAction } from "@/lib/actions/hse";
import * as ppe from "@/lib/modules/hse/ppe/ppe.service";

export const metadata: Metadata = { title: "New PPE check" };

/** Recording a PPE check (PRD #22 §158, §161). */
export default async function NewPpeCheckPage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.ppe.create")) notFound();

  const options = await ppe.ppeFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "PPE", href: "/hse/ppe" },
          { label: "New" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New PPE check</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          One person or one area. This never touches Inventory — issuing a helmet from the store
          is a stock issue, not a safety observation.
        </p>
      </div>

      <PpeForm
        action={createPpeCheckAction}
        cancelHref="/hse/ppe"
        submitLabel="Record check"
        pendingLabel="Recording…"
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
