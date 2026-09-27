import type { Metadata } from "next";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordDocuments } from "@/components/documents/record-documents";
import { MeetingWorkspace } from "@/components/meetings/meeting-workspace";
import { RecordFavorite } from "@/components/productivity/record-favorite";
import { listMeetingActivity } from "@/lib/modules/meetings/meeting.service";
import { getTranslations } from "@/lib/i18n/server";
import { loadMeeting } from "./meeting-context";

type Params = { params: Promise<{ meetingId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { meetingId } = await params;
  try {
    const { meeting } = await loadMeeting(meetingId);
    return { title: meeting.title };
  } catch {
    return { title: (await getTranslations("meetings"))("common.meeting") };
  }
}

/**
 * A meeting (PRD #40 §93-§95). The workspace is interactive; its documents and
 * discussion are the product's own record components, rendered here on the
 * server and handed in, so they authorise exactly as they do everywhere else
 * (PRD #40 §196, §197).
 */
export default async function MeetingPage({ params }: Params) {
  const { meetingId } = await params;
  const { context, meeting } = await loadMeeting(meetingId);
  const activity = await listMeetingActivity(context, meetingId);
  const t = await getTranslations("meetings");

  return (
    <MeetingWorkspace
      initial={meeting}
      activity={activity}
      documents={
        meeting.capabilities.canViewDocuments ? (
          <RecordDocuments
            key="documents"
            context={context}
            entityType="meeting"
            entityId={meeting.id}
            canAttach={meeting.capabilities.canUploadDocuments}
            title={t("documents.title")}
            emptyTitle={t("documents.emptyTitle")}
            emptyDescription={t("documents.emptyDescription")}
          />
        ) : null
      }
      discussion={<CollaborationPanel key="discussion" parentType="meeting" parentId={meeting.id} />}
      favorite={<RecordFavorite context={context} entityType="meeting" entityId={meeting.id} compact />}
    />
  );
}
