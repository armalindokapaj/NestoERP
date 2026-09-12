import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TemplateForm } from "@/components/qaqc/template-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createTemplateAction } from "@/lib/actions/qaqc";

export const metadata: Metadata = { title: "New template" };

/** Build an inspection checklist (PRD #21 §50). */
export default async function NewTemplatePage() {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.template.create")) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Templates", href: "/qaqc/templates" },
          { label: "New template" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New inspection template</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          The checklist inspections will be carried out against. Its checks are copied onto each
          inspection, so changing it later never rewrites what somebody actually checked.
        </p>
      </div>

      <TemplateForm
        action={createTemplateAction}
        cancelHref="/qaqc/templates"
        submitLabel="Create template"
        pendingLabel="Creating…"
      />
    </div>
  );
}
