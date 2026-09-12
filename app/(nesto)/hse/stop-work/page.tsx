import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HseListSection } from "@/components/hse/hse-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Stop work" };

/** Stop work: Jobs halted because it was not safe to carry on. */
export default async function HseStopWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  if (!can(context, "hse.stop_work.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hse");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="stop-work"
      description="Jobs halted because it was not safe to carry on."
      actions={
        <>
          {can(context, "hse.stop_work.create") ? (
            <Button asChild size="sm">
              <Link href="/hse/stop-work/new">Stop work</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <HseListSection context={context} kind="stop-work" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
