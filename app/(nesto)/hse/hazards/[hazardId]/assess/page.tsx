import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HazardAssessForm } from "@/components/hse/hazard-panels";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";

export const metadata: Metadata = { title: "Reassess risk" };

type Params = { params: Promise<{ hazardId: string }> };

/** Re-scoring a hazard once somebody who knows has looked (PRD #22 §70, §71). */
export default async function AssessHazardPage({ params }: Params) {
  const { hazardId } = await params;
  const context = await requireModule("hse");
  if (!can(context, "hse.hazard.assess")) notFound();

  let hazard;
  try {
    hazard = await hazards.getHazard(context, hazardId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!hazard.capabilities.canAssess) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Hazards", href: "/hse/hazards" },
          { label: hazard.hazardNumber, href: `/hse/hazards/${hazardId}` },
          { label: "Reassess" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Reassess {hazard.hazardNumber}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Score it as it stands now, and again as it will be once the controls are in. Controls
          reduce risk — the residual score cannot be higher than the first.
        </p>
      </div>

      <HazardAssessForm hazard={hazard} />
    </div>
  );
}
