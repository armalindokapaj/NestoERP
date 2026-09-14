import type { Metadata } from "next";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordDocuments } from "@/components/documents/record-documents";
import { MeetingWorkspace } from "@/components/meetings/meeting-workspace";
import { listMeetingActivity } from "@/lib/modules/meetings/meeting.service";
import { loadMeeting } from "./meeting-context";

type Params = { params: Promise<{ meetingId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { meetingId } = await params;
  try {
    const { meeting } = await loadMeeting(meetingId);
    return { title: meeting.title };
  } catch {
    return { title: "Meeting" };
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
            title="Documents"
            emptyTitle="No documents on this meeting."
            emptyDescription="Agendas, drawings, presentations, site photos and reports shared for this meeting appear here."
          />
        ) : null
      }
      discussion={<CollaborationPanel key="discussion" parentType="meeting" parentId={meeting.id} />}
    />
  );
}
