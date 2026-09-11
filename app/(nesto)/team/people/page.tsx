import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { TeamList } from "../team-list";

export const metadata: Metadata = { title: "People" };

export default async function TeamPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("team");
  const experience = resolveModuleExperience(context, "team");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="people"
      actions={
        can(context, "team.member.invite") ? (
          <Button asChild size="sm">
            <Link href="/team/invite">Invite member</Link>
          </Button>
        ) : null
      }
    >
      {/* Below the guard, so an unauthorised request is refused by the response
          itself rather than streamed a 200 (PRD #14 §189). */}
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <TeamList context={context} searchParams={params} variant="people" basePath="/team/people" />
      </Suspense>
    </ModulePage>
  );
}
