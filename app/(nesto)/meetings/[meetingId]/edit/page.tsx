import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { MeetingForm } from "@/components/meetings/meeting-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { meetingFormOptions } from "@/lib/modules/meetings/meeting.options";
import { getMeeting } from "@/lib/modules/meetings/meeting.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meetings");
  return { title: t("meta.editMeeting") };
}

type Params = { params: Promise<{ meetingId: string }> };

/** Edit a meeting's title, time, place and context (PRD #40 §158, §249). People, agenda and minutes are changed on the meeting. */
export default async function EditMeetingPage({ params }: Params) {
  const { meetingId } = await params;
  const context = await requireModule("meetings");
  const meeting = await getMeeting(context, meetingId).catch((error) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (!meeting.capabilities.canEdit) redirect(`/meetings/${meetingId}`);
  const options = await meetingFormOptions(context).catch(() => null);
  if (!options) redirect(`/meetings/${meetingId}`);
  const t = await getTranslations("meetings");

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: t("common.meetings"), href: "/meetings" }, { label: meeting.title, href: `/meetings/${meetingId}` }, { label: t("editPage.edit") }]} />
      <div>
        <h1 className="text-page font-semibold text-fg">{t("editPage.title")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {meeting.status === "COMPLETED" ? t("editPage.held") : t("editPage.notice")}
        </p>
      </div>
      <MeetingForm mode="edit" options={options} meeting={meeting} />
    </div>
  );
}
