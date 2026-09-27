import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TemplateForm } from "@/components/hse/template-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createTemplateAction } from "@/lib/actions/hse";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.templates") };
}

/** Building a safety checklist (PRD #22 §43, §45). */
export default async function NewTemplatePage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.template.create")) redirect("/access-denied");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.templates.title"), href: "/hse/templates" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.newSafetyChecklist")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.newChecklistIntro")}
        </p>
      </div>

      <TemplateForm
        action={createTemplateAction}
        cancelHref="/hse/templates"
        submitLabel={t("page.createChecklist")}
        pendingLabel={t("page.creating")}
      />
    </div>
  );
}
