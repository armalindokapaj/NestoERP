import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TemplateForm } from "@/components/hse/template-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateTemplateAction } from "@/lib/actions/hse";
import * as templates from "@/lib/modules/hse/templates/template.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editChecklist") };
}

type Params = { params: Promise<{ templateId: string }> };

export default async function EditTemplatePage({ params }: Params) {
  const { templateId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.template.update")) notFound();

  let template;
  try {
    template = await templates.getTemplate(context, templateId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!template.capabilities.canEdit) notFound();

  const update = updateTemplateAction.bind(null, templateId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.templates.title"), href: "/hse/templates" },
          { label: template.code, href: `/hse/templates/${templateId}` },
          { label: t("template.detail.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.editNumber", { number: template.code })}</h1>
      </div>

      <TemplateForm
        action={update}
        cancelHref={`/hse/templates/${templateId}`}
        submitLabel={
          template.capabilities.wouldVersion
            ? t("page.saveAsVersion", { version: template.version + 1 })
            : t("page.saveChecklist")
        }
        pendingLabel={t("page.saving")}
        versionUpdatedAt={template.updatedAt}
        usageCount={template.usageCount}
        currentVersion={template.version}
        values={{
          code: template.code,
          name: template.name,
          inspectionType: template.inspectionType,
          description: template.description ?? "",
          items: template.items.map((item) => ({
            code: item.code ?? "",
            label: item.label,
            description: item.description ?? "",
            responseType: item.responseType,
            required: item.required,
            riskIfFailed: item.riskIfFailed ?? "",
            requiresNoteOnFail: item.requiresNoteOnFail,
          })),
        }}
      />
    </div>
  );
}
