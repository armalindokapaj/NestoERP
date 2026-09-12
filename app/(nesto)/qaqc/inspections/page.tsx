import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { QaqcExportLink } from "@/components/qaqc/export-link";
import { QaqcListSection } from "@/components/qaqc/qaqc-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Inspections" };

/** Inspections: The act of looking, and its verdict. Status says where it is; result says what was found. */
export default async function QaqcInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.inspection.view")) redirect("/access-denied");

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
      activeSection="inspections"
      description="The act of looking, and its verdict. Status says where it is; result says what was found."
      actions={
        <>
          {can(context, "qaqc.export") ? (
            <QaqcExportLink type="inspections" search={query} />
          ) : null}
          {can(context, "qaqc.inspection.create") ? (
            <Button asChild size="sm">
              <Link href="/qaqc/inspections/new">New inspection</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <QaqcListSection context={context} kind="inspections" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
