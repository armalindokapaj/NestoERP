import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DefectForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createDefectAction } from "@/lib/actions/qaqc";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";

export const metadata: Metadata = { title: "New defect" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Raise a defect (PRD #21 §116). */
export default async function NewDefectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.defect.create")) notFound();

  const params = await searchParams;
  const options = await defects.defectFormOptions(context);

  const read = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Defects", href: "/qaqc/defects" },
          { label: "New defect" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New defect</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Something on a job that needs putting right. If it also needs a root cause and a formal
          response, escalate it to an NCR once it is raised.
        </p>
      </div>

      <DefectForm
        action={createDefectAction}
        cancelHref="/qaqc/defects"
        submitLabel="Raise defect"
        pendingLabel="Raising…"
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
