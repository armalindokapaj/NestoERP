import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PermitForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createPermitAction } from "@/lib/actions/hse";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.newWorkPermit") };
}

/** Requesting authorisation for controlled work (PRD #22 §145). */
export default async function NewPermitPage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.permit.create")) notFound();

  const options = await permits.permitFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("page.crumbPermits"), href: "/hse/permits" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.newWorkPermit")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.permitIntro")}
        </p>
      </div>

      <PermitForm
        action={createPermitAction}
        cancelHref="/hse/permits"
        submitLabel={t("page.raisePermit")}
        pendingLabel={t("page.raising")}
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
