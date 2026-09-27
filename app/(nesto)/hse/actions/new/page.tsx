import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createHseActionAction } from "@/lib/actions/hse";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.newHseAction") };
}

/**
 * Raising a safety action (PRD #22 §119).
 *
 * The record it came out of is carried through the query string, so raising an
 * action from a hazard keeps the two joined and puts the action on the right
 * site (PRD #22 §239).
 */
const PARENTS = [
  { param: "hazardId", label: "a hazard" },
  { param: "incidentId", label: "an incident" },
  { param: "inspectionId", label: "an inspection" },
  { param: "riskAssessmentId", label: "a risk assessment" },
  { param: "environmentalObservationId", label: "an environmental observation" },
  { param: "stopWorkId", label: "a stop-work" },
  { param: "permitId", label: "a work permit" },
] as const;

export default async function NewHseActionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.action.create")) notFound();

  const params = await searchParams;
  const options = await actionService.actionFormOptions(context);

  const found = PARENTS.map((parent) => ({
    ...parent,
    id: typeof params[parent.param] === "string" ? (params[parent.param] as string) : null,
  })).find((parent) => parent.id !== null);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.actions.title"), href: "/hse/actions" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.newHseAction")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.actionIntro")}
        </p>
      </div>

      <ActionForm
        action={createHseActionAction}
        cancelHref="/hse/actions"
        submitLabel={t("page.raiseAction")}
        pendingLabel={t("page.raising")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        parent={
          found ? { field: found.param, id: found.id!, label: found.label } : undefined
        }
      />
    </div>
  );
}
