import { Suspense } from "react";
import type { Metadata } from "next";

import { ModulePage } from "@/components/modules/module-page";
import { SkeletonTable } from "@/components/ui/loading-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { TeamList } from "../team-list";

export const metadata: Metadata = { title: "Inactive" };

/**
 * People who no longer have access (PRD #14 §36, §104).
 *
 * Deactivated members are kept, never deleted: their history of assignments,
 * approvals and comments has to stay readable (PRD #14 §103, §246).
 */
export default async function TeamInactivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("team");
  const experience = resolveModuleExperience(context, "team");
  const params = await searchParams;

  return (
    <ModulePage experience={experience} activeSection="inactive">
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <TeamList
          context={context}
          searchParams={params}
          variant="inactive"
          basePath="/team/inactive"
        />
      </Suspense>
    </ModulePage>
  );
}
