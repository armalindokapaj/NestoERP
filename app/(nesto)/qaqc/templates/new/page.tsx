import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { TemplateForm } from "@/components/qaqc/template-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createTemplateAction } from "@/lib/actions/qaqc";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.newTemplate") };
}

/** Build an inspection checklist (PRD #21 §50). */
export default async function NewTemplatePage() {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.template.create")) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.templates"), href: "/qaqc/templates" },
          { label: t("crumbs.newTemplate") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("templatePage.newTitle")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("templatePage.newIntro")}
        </p>
      </div>

      <TemplateForm
        action={createTemplateAction}
        cancelHref="/qaqc/templates"
        submitLabel={t("templatePage.create")}
        pendingLabel={t("common.creating")}
      />
    </div>
  );
}
