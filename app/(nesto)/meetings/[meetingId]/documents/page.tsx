import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { getTranslations } from "@/lib/i18n/server";
import { loadMeeting } from "../meeting-context";

type Params = { params: Promise<{ meetingId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meetings");
  return { title: t("meta.documents") };
}

/** Files on a meeting (PRD #40 §68-§72): the route an upload started from the meeting returns to. */
export default async function MeetingDocumentsPage({ params }: Params) {
  const { meetingId } = await params;
  const { context, meeting } = await loadMeeting(meetingId);
  if (!meeting.capabilities.canViewDocuments) notFound();
  const t = await getTranslations("meetings");

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: t("common.meetings"), href: "/meetings" }, { label: meeting.title, href: `/meetings/${meeting.id}` }, { label: t("documents.title") }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-page font-semibold text-fg">{meeting.title}</h1>
        <Link href={`/meetings/${meeting.id}`} className="text-table font-medium text-accent-strong">
          {t("common.backToMeeting")}
        </Link>
      </div>
      <RecordDocuments
        context={context}
        entityType="meeting"
        entityId={meeting.id}
        canAttach={meeting.capabilities.canUploadDocuments}
        emptyTitle={t("documents.emptyTitle")}
        emptyDescription={t("documents.emptyDescription")}
      />
    </div>
  );
}
