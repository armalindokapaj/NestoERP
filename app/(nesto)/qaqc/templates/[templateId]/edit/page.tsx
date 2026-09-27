import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { TemplateForm } from "@/components/qaqc/template-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateTemplateAction } from "@/lib/actions/qaqc";
import * as templates from "@/lib/modules/qaqc/templates/template.service";

type Params = { params: Promise<{ templateId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.editTemplate") };
}

/**
 * Edit a template (PRD #21 §53).
 *
 * If it has been used, saving writes a new version rather than changing the
 * old one — and the form says so before anybody types anything.
 */
export default async function EditTemplatePage({ params }: Params) {
  const { templateId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

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
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.templates"), href: "/qaqc/templates" },
          {
            label: `${template.code} v${template.version}`,
            href: `/qaqc/templates/${template.id}`,
          },
          { label: t("crumbs.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">
          {template.usageCount > 0 ? t("templatePage.newVersionTitle") : t("meta.editTemplate")}
        </h1>
        <p className="mt-1.5 text-body text-fg-muted">{template.name}</p>
      </div>

      <TemplateForm
        action={action}
        versionUpdatedAt={template.updatedAt}
        cancelHref={`/qaqc/templates/${template.id}`}
        submitLabel={template.usageCount > 0 ? t("templatePage.saveAsVersion") : t("common.saveChanges")}
        pendingLabel={t("common.saving")}
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
