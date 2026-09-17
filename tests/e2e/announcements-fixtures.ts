import { ANNOUNCEMENT_SEED, seedAnnouncementRecords } from "../../prisma/seed/announcements";
import { seedMembers } from "../../prisma/seed/members";
import { db, removeRecordTrail } from "./db";

/**
 * Announcement, favorite and recent-work fixtures for E2E (PRD #45 §321-§328).
 *
 * Specs publish their own announcements, star records and open pages. After
 * them every announcement they created goes, with its files and trail, and the
 * seeded announcements, favorites and recent work are written back as the seed
 * leaves them.
 */

export { ANNOUNCEMENT_SEED };

export async function memberIdFor(email: string, companyId = "company_demo_a"): Promise<string> {
  const member = await db.companyMember.findFirstOrThrow({ where: { companyId, user: { email } }, select: { id: true } });
  return member.id;
}

export async function resetAnnouncements(): Promise<void> {
  const created = await db.announcement.findMany({ where: { id: { notIn: Object.values(ANNOUNCEMENT_SEED) } }, select: { id: true } });
  const ids = created.map((row) => row.id);
  const documents = await db.document.findMany({ where: { entityType: "announcement", entityId: { in: ids } }, select: { id: true } });
  await removeRecordTrail("announcement", ids);
  await removeRecordTrail("document", documents.map((row) => row.id));
  await db.activity.deleteMany({ where: { entityId: { in: [...ids, ...documents.map((row) => row.id)] } } });
  await db.documentUploadSession.deleteMany({ where: { documentId: { in: documents.map((row) => row.id) } } });
  await db.document.deleteMany({ where: { id: { in: documents.map((row) => row.id) } } });
  await db.announcement.deleteMany({ where: { id: { in: ids } } });
  await seedAnnouncementRecords(db, seedMembers());
}
