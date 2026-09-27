import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PpeForm } from "@/components/hse/ppe-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createPpeCheckAction } from "@/lib/actions/hse";
import * as ppe from "@/lib/modules/hse/ppe/ppe.service";
import { WORKER_PREFIX } from "@/lib/modules/hse/hse.schema";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("list.create.ppe") };
}

/** Recording a PPE check (PRD #22 §158, §161). */
export default async function NewPpeCheckPage() {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.ppe.create")) notFound();

  const options = await ppe.ppeFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("page.crumbPpe"), href: "/hse/ppe" },
          { label: t("page.crumbNew") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("list.create.ppe")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.ppeIntro")}
        </p>
      </div>

      <PpeForm
        action={createPpeCheckAction}
        cancelHref="/hse/ppe"
        submitLabel={t("page.recordCheck")}
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
