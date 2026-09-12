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

export const metadata: Metadata = { title: "Corrective actions" };

/** Corrective actions: What somebody actually does about a non-conformance — and the reason an NCR can close. */
export default async function QaqcCorrectiveActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.corrective_action.view")) redirect("/access-denied");

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
      activeSection="corrective-actions"
      description="What somebody actually does about a non-conformance — and the reason an NCR can close."
      actions={
        <>
          {can(context, "qaqc.export") ? (
            <QaqcExportLink type="corrective-actions" search={query} />
          ) : null}
          {can(context, "qaqc.corrective_action.create") ? (
            <Button asChild size="sm">
              <Link href="/qaqc/corrective-actions/new">New corrective action</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <QaqcListSection context={context} kind="corrective-actions" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
