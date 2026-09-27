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
import { getTranslations } from "@/lib/i18n/server";
import { meetingExperience } from "@/lib/modules/meetings/meeting.workspace";
import { MeetingsSection } from "../meetings-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meetings");
  return { title: t("meta.mine") };
}

/** Meetings the reader organizes, chairs, keeps the minutes of or attends (PRD #40 §122). */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("meetings");
  const experience = meetingExperience(context);
  const params = await searchParams;
  const t = await getTranslations("meetings");

  return (
    <ModulePage
      experience={experience}
      activeSection="mine"
      actions={
        // Scheduling needs a company; the Group workspace only reads (Workspace Context §34).
        !inGroupWorkspace(context) && can(context, "meeting.create") ? (
          <Button asChild size="sm">
            <Link href="/meetings/new">
              <Plus aria-hidden="true" />
              {t("common.newMeeting")}
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
