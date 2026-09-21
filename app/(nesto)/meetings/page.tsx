import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { meetingExperience } from "@/lib/modules/meetings/meeting.workspace";
import { MeetingsSection } from "./meetings-section";

export const metadata: Metadata = { title: "Meetings" };

/** Upcoming meetings, soonest first — the default view (PRD #40 §91). */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("meetings");
  const experience = meetingExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="upcoming"
      actions={
        // Scheduling needs a company; the Group workspace only reads (Workspace Context §34).
        !inGroupWorkspace(context) && can(context, "meeting.create") ? (
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
        <MeetingsSection context={context} section="upcoming" searchParams={params} basePath="/meetings" />
      </Suspense>
    </ModulePage>
  );
}
