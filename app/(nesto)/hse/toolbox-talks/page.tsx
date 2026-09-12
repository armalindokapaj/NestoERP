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

export const metadata: Metadata = { title: "Toolbox talks" };

/** Toolbox talks: Short briefings, and who was there. */
export default async function HseToolboxTalksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  if (!can(context, "hse.toolbox.view")) redirect("/access-denied");

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
      activeSection="toolbox-talks"
      description="Short briefings, and who was there."
      actions={
        <>
          {can(context, "hse.export") ? (
            <HseExportLink kind="toolbox-talks" search={query} />
          ) : null}
          {can(context, "hse.toolbox.create") ? (
            <Button asChild size="sm">
              <Link href="/hse/toolbox-talks/new">Record a talk</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <HseListSection context={context} kind="toolbox-talks" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
