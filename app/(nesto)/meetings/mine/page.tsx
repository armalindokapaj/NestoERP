import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { MeetingsSection } from "../meetings-section";

export const metadata: Metadata = { title: "My Meetings" };

/** Meetings the reader organizes, chairs, keeps the minutes of or attends (PRD #40 §122). */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("meetings");
  const experience = resolveModuleExperience(context, "meetings");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="mine"
      actions={
        can(context, "meeting.create") ? (
          <Button asChild size="sm">
            <Link href="/meetings/new">
              <Plus aria-hidden="true" />
              New meeting
            </Link>
          </Button>
        ) : null
      }
    >
      {/* Suspense below the guard, so a refusal is never streamed as a 200 (PRD #11 §151). */}
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <MeetingsSection context={context} section="mine" searchParams={params} basePath="/meetings/mine" />
      </Suspense>
    </ModulePage>
  );
}
