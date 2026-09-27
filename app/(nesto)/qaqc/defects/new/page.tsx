import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { DefectForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createDefectAction } from "@/lib/actions/qaqc";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.newDefect") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Raise a defect (PRD #21 §116). */
export default async function NewDefectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.defect.create")) notFound();

  const params = await searchParams;
  const options = await defects.defectFormOptions(context);

  const read = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.defects"), href: "/qaqc/defects" },
          { label: t("crumbs.newDefect") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newDefect")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("defectPage.newIntro")}
        </p>
      </div>

      <DefectForm
        action={createDefectAction}
        cancelHref="/qaqc/defects"
        submitLabel={t("defectPage.raise")}
        pendingLabel={t("common.raising")}
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
          projectId: read("projectId"),
          inspectionId: read("inspectionId"),
          severity: "MEDIUM",
          locationText: "",
          assignedToMemberId: "",
          dueDate: "",
        }}
      />
    </div>
  );
}
