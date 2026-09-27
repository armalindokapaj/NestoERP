import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StopWorkForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createStopWorkAction } from "@/lib/actions/hse";
import * as stopWork from "@/lib/modules/hse/stop-work/stop-work.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("pages.stopWork.title") };
}

/**
 * Halting a job (PRD #22 §173).
 *
 * A contributor-level act on purpose: anybody who can see the work going wrong
 * can stop it. Letting it restart is a different grant.
 */
export default async function NewStopWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.stop_work.create")) notFound();

  const params = await searchParams;
  const options = await stopWork.stopWorkFormOptions(context);

  const hazardId = typeof params.hazardId === "string" ? params.hazardId : null;
  const incidentId = typeof params.incidentId === "string" ? params.incidentId : null;

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.stopWork.title"), href: "/hse/stop-work" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("pages.stopWork.title")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.stopWorkIntro")}
        </p>
      </div>

      <StopWorkForm
        action={createStopWorkAction}
        cancelHref="/hse/stop-work"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        parent={
          hazardId
            ? { field: "hazardId", id: hazardId, label: "a hazard" }
            : incidentId
              ? { field: "incidentId", id: incidentId, label: "an incident" }
              : undefined
        }
      />
    </div>
  );
}
