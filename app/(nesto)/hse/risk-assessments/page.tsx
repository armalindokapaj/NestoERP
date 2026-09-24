import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { HseListSection } from "@/components/hse/hse-list";
import { HseExportLink } from "@/components/hse/export-link";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Risk assessments" };

/** Risk assessments: Structured evaluations of an activity. Approved ones are frozen. */
export default async function HseRiskAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  if (!can(context, "hse.risk.view")) redirect("/access-denied");

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
      activeSection="risk-assessments"
      description="Structured evaluations of an activity. Approved ones are frozen."
      actions={
        <>
          {can(context, "hse.export") ? (
            <HseExportLink kind="risk-assessments" search={query} />
          ) : null}
          {can(context, "hse.risk.create") ? (
            <Button asChild size="sm">
              <Link href="/hse/risk-assessments/new">New risk assessment</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <HseListSection context={context} kind="risk-assessments" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
