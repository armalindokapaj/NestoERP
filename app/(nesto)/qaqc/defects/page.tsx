import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { QaqcExportLink } from "@/components/qaqc/export-link";
import { QaqcListSection } from "@/components/qaqc/qaqc-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Defects" };

/** Defects: Faults on a job that somebody must fix. */
export default async function QaqcDefectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.defect.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();

  return (
    <ModulePage
      experience={experience}
      activeSection="defects"
      description="Faults on a job that somebody must fix."
      actions={
        <>
          {can(context, "qaqc.export") ? (
            <QaqcExportLink type="defects" search={query} />
          ) : null}
          {can(context, "qaqc.defect.create") ? (
            <Button asChild size="sm">
              <Link href="/qaqc/defects/new">New defect</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <QaqcListSection context={context} kind="defects" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
