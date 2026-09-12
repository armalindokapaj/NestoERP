import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { QaqcListSection } from "@/components/qaqc/qaqc-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Material inspections" };

/**
 * Material inspections.
 *
 * The same canonical inspections as /qaqc/inspections, narrowed to one type —
 * not a second table. The filter is fixed in the URL so the section is a real
 * place rather than a saved search somebody has to remember.
 */
export default async function QaqcMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.inspection.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="materials"
      description="Quality decisions on delivered material. Accepted, rejected and conditional always add back to what was inspected."
      actions={
        can(context, "qaqc.inspection.create") ? (
          <Button asChild size="sm">
            <Link href="/qaqc/inspections/new">New inspection</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <QaqcListSection
          context={context}
          kind="inspections"
          searchParams={{ ...params, type: "MATERIAL" }}
        />
      </Suspense>
    </ModulePage>
  );
}
