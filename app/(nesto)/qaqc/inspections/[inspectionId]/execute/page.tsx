import type { Metadata } from "next";

import { ChecklistExecutor } from "@/components/qaqc/checklist-executor";
import { SubmitInspection } from "@/components/qaqc/submit-inspection";
import { InspectionPageShell, loadInspectionPage } from "../inspection-shell";

export const metadata: Metadata = { title: "Checklist" };

type Params = { params: Promise<{ inspectionId: string }> };

/**
 * Carrying out the inspection (PRD #21 §71–§79).
 *
 * The checklist is the snapshot taken when the inspection was created, so what
 * is being answered here is exactly what was asked on the day — whatever has
 * happened to the template since.
 */
export default async function ExecuteInspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const { context, inspection } = await loadInspectionPage(inspectionId, "execute");

  const editable = inspection.capabilities.canExecute;

  return (
    <InspectionPageShell context={context} inspection={inspection} tab="execute">
      <div className="space-y-5">
        {!editable ? (
          <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
            {inspection.status === "DRAFT" || inspection.status === "IN_PROGRESS"
              ? "This inspection is assigned to somebody else."
              : "This inspection has been submitted, so its answers are fixed."}
          </p>
        ) : null}

        <ChecklistExecutor
          inspectionId={inspection.id}
          items={inspection.checklist}
          readOnly={!editable}
        />

        {inspection.capabilities.canSubmit ? (
          <SubmitInspection
            inspectionId={inspection.id}
            allowedResults={inspection.allowedResults}
            blockers={inspection.blockers}
            defaultSummary={inspection.summary ?? ""}
          />
        ) : null}
      </div>
    </InspectionPageShell>
  );
}
