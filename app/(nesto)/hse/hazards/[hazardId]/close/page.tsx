import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BlockedList } from "@/components/hse/hse-format";
import { HazardCloseForm } from "@/components/hse/hazard-panels";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import { hazardClosureGapLabels } from "@/lib/modules/hse/hse.status";

export const metadata: Metadata = { title: "Close hazard" };

type Params = { params: Promise<{ hazardId: string }> };

/** Closing a hazard (PRD #22 §73). */
export default async function CloseHazardPage({ params }: Params) {
  const { hazardId } = await params;
  const context = await requireModule("hse");
  if (!can(context, "hse.hazard.close")) notFound();

  let hazard;
  try {
    hazard = await hazards.getHazard(context, hazardId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!hazard.capabilities.canClose) notFound();

  // Everything except the closure note and residual risk, which this page is
  // about to collect.
  const outstanding = hazard.closureGaps.filter(
    (gap) => gap !== "CLOSURE_NOTE" && gap !== "RESIDUAL_RISK",
  );

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Hazards", href: "/hse/hazards" },
          { label: hazard.hazardNumber, href: `/hse/hazards/${hazardId}` },
          { label: "Close" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Close {hazard.hazardNumber}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          A hazard closes when the control is genuinely in — not when somebody is tired of looking
          at it.
        </p>
      </div>

      <BlockedList
        title="Still outstanding"
        reasons={outstanding.map((gap) => hazardClosureGapLabels[gap])}
      />

      {outstanding.length === 0 ? <HazardCloseForm hazard={hazard} /> : null}
    </div>
  );
}
