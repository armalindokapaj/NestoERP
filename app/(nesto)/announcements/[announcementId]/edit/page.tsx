import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AnnouncementEditor, toLocalInput } from "@/components/announcements/announcement-editor";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { announcementOptions, getAnnouncement } from "@/lib/modules/announcements/announcement.service";

export const metadata: Metadata = { title: "Edit announcement" };

type Params = { params: Promise<{ announcementId: string }> };

/** Editing, as far as its state allows (PRD #45 §145-§153). */
export default async function EditAnnouncementPage({ params }: Params) {
  const { announcementId } = await params;
  const context = await requireModule("announcements");
  const announcement = await getAnnouncement(context, announcementId).catch((error: unknown) => {
    if (error instanceof AccessError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  });
  if (!announcement.capabilities.canEdit) redirect(`/announcements/${announcement.id}`);
  const options = await announcementOptions(context);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-page font-semibold tracking-tight text-fg">Edit announcement</h1>
        <p className="mt-1.5 text-body text-fg-muted">{announcement.status === "PUBLISHED" ? "Corrections are marked as updated for readers." : "Changes stay in the draft until it is published."}</p>
      </header>
      <AnnouncementEditor
        mode="edit"
        announcementId={announcement.id}
        version={announcement.version}
        options={options}
        lockedAudience={!announcement.capabilities.canEditAudience}
        lockedContent={!announcement.capabilities.canEditContent}
        lockedAcknowledgment={announcement.status === "PUBLISHED"}
        initial={{
          title: announcement.title,
          body: announcement.body,
          priority: announcement.priority,
          audienceType: announcement.audience.type,
          projectId: announcement.audience.project?.id ?? "",
          departmentId: announcement.audience.department?.id ?? "",
          selectedMemberIds: announcement.selectedMembers?.map((member) => member.memberId) ?? [],
          expiresAt: toLocalInput(announcement.expiresAt),
          eventStartsAt: toLocalInput(announcement.eventStartsAt),
          eventEndsAt: toLocalInput(announcement.eventEndsAt),
          pinned: announcement.pinned,
          requiresAcknowledgment: announcement.requiresAcknowledgment,
        }}
      />
    </div>
  );
}
