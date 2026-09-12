import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TemplateForm } from "@/components/hse/template-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createTemplateAction } from "@/lib/actions/hse";

export const metadata: Metadata = { title: "New checklist" };

/** Building a safety checklist (PRD #22 §43, §45). */
export default async function NewTemplatePage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.template.create")) redirect("/access-denied");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Checklists", href: "/hse/templates" },
          { label: "New" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New safety checklist</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          What inspectors answer on site. One list means two sites cannot hold the same work to different standards.
        </p>
      </div>

      <TemplateForm
        action={createTemplateAction}
        cancelHref="/hse/templates"
        submitLabel="Create checklist"
        pendingLabel="Creating…"
      />
    </div>
  );
}
