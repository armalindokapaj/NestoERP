import type { Metadata } from "next";

import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { InspectionPageShell, loadInspectionPage } from "../inspection-shell";

export const metadata: Metadata = { title: "Activity" };

type Params = { params: Promise<{ inspectionId: string }> };

/** One inspection's history (PRD #21 §186). */
export default async function InspectionActivityPage({ params }: Params) {
  const { inspectionId } = await params;
  const { context, inspection } = await loadInspectionPage(inspectionId, "activity");

  return (
    <InspectionPageShell inspection={inspection} tab="activity">
      <QaqcActivityFeed
        context={context}
        entityType="QualityInspection"
        entityId={inspection.id}
      />
    </InspectionPageShell>
  );
}
