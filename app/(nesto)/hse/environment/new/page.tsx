import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ObservationForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createObservationAction } from "@/lib/actions/hse";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.environment") };
}

/** Reporting an environmental observation (PRD #22 §163). */
export default async function NewObservationPage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.environment.create")) notFound();

  const options = await environment.observationFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.environment.title"), href: "/hse/environment" },
          { label: t("page.crumbReport") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.reportEnvObservation")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.envIntro")}
        </p>
      </div>

      <ObservationForm
        action={createObservationAction}
        cancelHref="/hse/environment"
        submitLabel={t("page.reportObservation")}
        pendingLabel={t("page.reporting")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        canAssign={can(context, "hse.environment.update")}
      />
    </div>
  );
}
