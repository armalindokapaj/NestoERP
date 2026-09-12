import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChecklistExecutor } from "@/components/hse/checklist-executor";
import { SubmitInspection } from "@/components/hse/submit-inspection";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";

export const metadata: Metadata = { title: "Execute inspection" };

type Params = { params: Promise<{ inspectionId: string }> };

/**
 * Answering the checklist on site (PRD #22 §41, §51, §334).
 *
 * Built for a phone held in one hand: each item is its own card, and answers
 * save in one go so a lost signal halfway round does not lose the first half.
 */
export default async function ExecuteInspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("hse");
  if (!can(context, "hse.inspection.execute")) notFound();

  let inspection;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!inspection.capabilities.canExecute && !inspection.capabilities.canSubmit) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Inspections", href: "/hse/inspections" },
          { label: inspection.inspectionNumber, href: `/hse/inspections/${inspectionId}` },
          { label: "Execute" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{inspection.inspectionNumber}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {inspection.locationText
            ? `${inspection.locationText} · `
            : ""}
          {inspection.project?.name ?? "Company-wide"}
        </p>
      </div>

      <ChecklistExecutor
        inspectionId={inspection.id}
        items={inspection.checklistItems}
        readOnly={!inspection.capabilities.canExecute}
        versionUpdatedAt={inspection.updatedAt}
      />

      {inspection.capabilities.canSubmit ? (
        <SubmitInspection
          inspectionId={inspection.id}
          gaps={inspection.gaps}
          allowedResults={inspection.allowedResults}
          versionUpdatedAt={inspection.updatedAt}
        />
      ) : null}
    </div>
  );
}
