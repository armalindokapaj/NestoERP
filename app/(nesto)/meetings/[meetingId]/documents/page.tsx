import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { loadMeeting } from "../meeting-context";

type Params = { params: Promise<{ meetingId: string }> };

export const metadata: Metadata = { title: "Meeting documents" };

/** Files on a meeting (PRD #40 §68-§72): the route an upload started from the meeting returns to. */
export default async function MeetingDocumentsPage({ params }: Params) {
  const { meetingId } = await params;
  const { context, meeting } = await loadMeeting(meetingId);
  if (!meeting.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Meetings", href: "/meetings" }, { label: meeting.title, href: `/meetings/${meeting.id}` }, { label: "Documents" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-page font-semibold text-fg">{meeting.title}</h1>
        <Link href={`/meetings/${meeting.id}`} className="text-table font-medium text-accent-strong">
          Back to meeting
        </Link>
      </div>
      <RecordDocuments
        context={context}
        entityType="meeting"
        entityId={meeting.id}
        canAttach={meeting.capabilities.canUploadDocuments}
        emptyTitle="No documents on this meeting."
        emptyDescription="Agendas, drawings, presentations, site photos and reports shared for this meeting appear here."
      />
    </div>
  );
}
