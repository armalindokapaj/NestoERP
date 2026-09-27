import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ToolboxForm } from "@/components/hse/toolbox-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createToolboxTalkAction } from "@/lib/actions/hse";
import { WORKER_PREFIX } from "@/lib/modules/hse/hse.schema";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.toolbox-talks") };
}

/** A short safety briefing, and who was there (PRD #22 §136). */
export default async function NewToolboxTalkPage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.toolbox.create")) notFound();

  const options = await toolbox.toolboxFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.toolboxTalks.title"), href: "/hse/toolbox-talks" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("list.create.toolbox-talks")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.toolboxIntro")}
        </p>
      </div>

      <ToolboxForm
        action={createToolboxTalkAction}
        cancelHref="/hse/toolbox-talks"
        submitLabel={t("page.recordTalk")}
        pendingLabel={t("page.recording")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        workers={options.workers.map((worker) => ({ value: `${WORKER_PREFIX}${worker.id}`, label: worker.name }))}
      />
    </div>
  );
}
