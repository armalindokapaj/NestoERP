import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseActivityFeed } from "@/components/hse/record-activity";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";

export const metadata: Metadata = { title: "Hazard activity" };

type Params = { params: Promise<{ hazardId: string }> };

export default async function HazardActivityPage({ params }: Params) {
  const { hazardId } = await params;
  const context = await requireModule("hse");

  let hazard;
  try {
    hazard = await hazards.getHazard(context, hazardId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!hazard.capabilities.canViewActivity) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Hazards", href: "/hse/hazards" },
          { label: hazard.hazardNumber, href: `/hse/hazards/${hazardId}` },
          { label: "Activity" },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">Activity on {hazard.hazardNumber}</h1>

      <HseActivityFeed context={context} entityType="HseHazard" entityId={hazard.id} />
    </div>
  );
}
