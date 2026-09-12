import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CorrectiveActionForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createActionAction } from "@/lib/actions/qaqc";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export const metadata: Metadata = { title: "New corrective action" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Raise a corrective action (PRD #21 §144). */
export default async function NewCorrectiveActionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
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
          { label: "QA/QC", href: "/qaqc" },
          { label: "Corrective actions", href: "/qaqc/corrective-actions" },
          { label: "New action" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New corrective action</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          What will actually be done so the problem does not come back. Whoever carries it out
          records what they did, and somebody else verifies it.
        </p>
      </div>

      <CorrectiveActionForm
        action={createActionAction}
        cancelHref={ncrId ? `/qaqc/ncrs/${ncrId}` : "/qaqc/corrective-actions"}
        submitLabel="Raise action"
        pendingLabel="Raising…"
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
