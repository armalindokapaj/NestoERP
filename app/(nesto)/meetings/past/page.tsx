import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { Plus } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { meetingExperience } from "@/lib/modules/meetings/meeting.workspace";
import { MeetingsSection } from "../meetings-section";

export const metadata: Metadata = { title: "Past meetings" };

/** Held and cancelled meetings, newest first (PRD #40 §90). */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("meetings");
  const experience = meetingExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="past"
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
        <MeetingsSection context={context} section="past" searchParams={params} basePath="/meetings/past" />
      </Suspense>
    </ModulePage>
  );
}
