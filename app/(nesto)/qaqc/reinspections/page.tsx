import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { QaqcListSection } from "@/components/qaqc/qaqc-list";
import { ModulePage } from "@/components/modules/module-page";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Reinspections" };

/**
 * Work that has been looked at more than once (PRD #21 §154, §198).
 *
 * Each reinspection is a separate record with its own verdict, linked to the
 * one it re-examines. Both verdicts stay on the record — that is the whole
 * point of not simply reopening the original.
 */
export default async function QaqcReinspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.reinspection.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="reinspections"
      description="Work that failed or was accepted with a condition, and has been looked at again. Each re-look carries its own verdict."
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <QaqcListSection
          context={context}
          kind="inspections"
          searchParams={params}
          basePath="/qaqc/reinspections"
          fixed={{ view: "reinspections" }}
        />
      </Suspense>
    </ModulePage>
  );
}
