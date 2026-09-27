import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { CorrectiveActionForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createActionAction } from "@/lib/actions/qaqc";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.newCorrectiveAction") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Raise a corrective action (PRD #21 §144). */
export default async function NewCorrectiveActionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.corrective_action.create")) notFound();

  const params = await searchParams;
  const options = await actions.actionFormOptions(context);

  const read = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const ncrId = read("ncrId");

  // Named through the reader's own scope, so the label cannot confirm that an
  // NCR they cannot open exists.
  let parentLabel: string | null = null;
  if (ncrId) {
    try {
      parentLabel = (await ncrs.getNcr(context, ncrId)).ncrNumber;
    } catch {
      parentLabel = null;
    }
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.correctiveActions"), href: "/qaqc/corrective-actions" },
          { label: t("crumbs.newAction") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newCorrectiveAction")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("actionPage.newIntro")}
        </p>
      </div>

      <CorrectiveActionForm
        action={createActionAction}
        cancelHref={ncrId ? `/qaqc/ncrs/${ncrId}` : "/qaqc/corrective-actions"}
        submitLabel={t("actionPage.raise")}
        pendingLabel={t("common.raising")}
        parentLabel={parentLabel}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        values={{
          title: "",
          description: "",
          ncrId,
          defectId: read("defectId"),
          inspectionId: read("inspectionId"),
          projectId: "",
          assignedToMemberId: "",
          dueDate: "",
        }}
      />
    </div>
  );
}
