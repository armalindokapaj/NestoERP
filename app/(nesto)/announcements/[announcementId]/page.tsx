import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AnnouncementDetail } from "@/components/announcements/announcement-detail";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getAnnouncement } from "@/lib/modules/announcements/announcement.service";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";

type Params = { params: Promise<{ announcementId: string }> };

async function load(announcementId: string) {
  const context = await requireModule("announcements");
  try {
    return { context, announcement: await getAnnouncement(context, announcementId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { announcementId } = await params;
  try {
    const { announcement } = await load(announcementId);
    return { title: announcement.title };
  } catch {
    return { title: "Announcement" };
  }
}

/** One announcement, for the people it is addressed to and the people who manage it; anyone else is told it does not exist (PRD #45 §61, §158). */
export default async function AnnouncementPage({ params }: Params) {
  const { announcementId } = await params;
  const { context, announcement } = await load(announcementId);
  const company = await ensureCompanySettings(context.companyId);
  return <AnnouncementDetail initial={announcement} zone={company.timezone} />;
}
