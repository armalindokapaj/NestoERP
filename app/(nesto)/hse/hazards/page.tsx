import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HseListSection } from "@/components/hse/hse-list";
import { HseExportLink } from "@/components/hse/export-link";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Hazards" };

/** Hazards: Conditions that could hurt somebody, scored on the 5×5 matrix. */
export default async function HseHazardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  if (!can(context, "hse.hazard.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hse");
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();

  return (
    <ModulePage
      experience={experience}
      activeSection="hazards"
      description="Conditions that could hurt somebody, scored on the 5×5 matrix."
      actions={
        <>
          {can(context, "hse.export") ? (
            <HseExportLink kind="hazards" search={query} />
          ) : null}
          {can(context, "hse.hazard.create") ? (
            <Button asChild size="sm">
              <Link href="/hse/hazards/new">Report a hazard</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <HseListSection context={context} kind="hazards" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
