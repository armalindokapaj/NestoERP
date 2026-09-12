import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TemplateForm } from "@/components/qaqc/template-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateTemplateAction } from "@/lib/actions/qaqc";
import * as templates from "@/lib/modules/qaqc/templates/template.service";

type Params = { params: Promise<{ templateId: string }> };

export const metadata: Metadata = { title: "Edit template" };

/**
 * Edit a template (PRD #21 §53).
 *
 * If it has been used, saving writes a new version rather than changing the
 * old one — and the form says so before anybody types anything.
 */
export default async function EditTemplatePage({ params }: Params) {
  const { templateId } = await params;
  const context = await requireModule("qaqc");

  let template;
  try {
    template = await templates.getTemplate(context, templateId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!template.capabilities.canEdit) notFound();

  async function action(formData: FormData) {
    "use server";
    return updateTemplateAction(templateId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Templates", href: "/qaqc/templates" },
          {
            label: `${template.code} v${template.version}`,
            href: `/qaqc/templates/${template.id}`,
          },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">
          {template.usageCount > 0 ? "New template version" : "Edit template"}
        </h1>
        <p className="mt-1.5 text-body text-fg-muted">{template.name}</p>
      </div>

      <TemplateForm
        action={action}
        versionUpdatedAt={template.updatedAt}
        cancelHref={`/qaqc/templates/${template.id}`}
        submitLabel={template.usageCount > 0 ? "Save as new version" : "Save changes"}
        pendingLabel="Saving…"
        usageCount={template.usageCount}
        currentVersion={template.version}
        values={{
          code: template.code,
          name: template.name,
          inspectionType: template.inspectionType,
          description: template.description ?? "",
          status: template.status,
          items: template.items.map((item) => ({
            code: item.code ?? "",
            label: item.label,
            description: item.description ?? "",
            responseType: item.responseType,
            required: item.required,
            passCriteriaText: item.passCriteriaText ?? "",
            requiresEvidenceOnFail: item.requiresEvidenceOnFail,
          })),
        }}
      />
    </div>
  );
}
