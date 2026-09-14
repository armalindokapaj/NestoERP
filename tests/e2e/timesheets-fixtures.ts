import { seedTimesheetRecords, TIMESHEET_SEED } from "../../prisma/seed/timesheets";
import { db } from "./db";

/**
 * Timesheet fixtures for E2E (PRD #42 §261-§264).
 *
 * Specs work on real weeks: the Engineer's current week and the one waiting
 * for the Project Manager, and the HSE officer's current week on a phone.
 * Afterwards every week they created goes, with the trail it left, and the
 * seeded weeks are written back exactly as the seed leaves them — so the next
 * run tests the same world.
 */

const COMPANY = "company_demo_a";

export { TIMESHEET_SEED };

export async function memberId(email: string): Promise<string> {
  const member = await db.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email } }, select: { id: true } });
  return member.id;
}

export async function resetTimesheets(emails: string[], since = new Date(Date.now() - 60 * 60_000)): Promise<void> {
  const memberIds = await Promise.all(emails.map(memberId));
  const weeks = await db.timesheet.findMany({ where: { OR: [{ memberId: { in: memberIds }, id: { not: { startsWith: "timesheet_" } } }, { id: { in: Object.values(TIMESHEET_SEED) } }] }, select: { id: true } });
  const ids = weeks.map((row) => row.id);
  const cycles = await db.timesheetApproval.findMany({ where: { recordId: { in: ids } }, select: { id: true } });
  const cycleIds = cycles.map((row) => row.id);
  await db.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: cycleIds } } });
  await db.approvalStep.deleteMany({ where: { providerKey: "timesheets", approvalId: { in: cycleIds } } });
  await db.timesheetApproval.deleteMany({ where: { id: { in: cycleIds } } });
  const created = ids.filter((id) => !id.startsWith("timesheet_"));
  await db.workLog.deleteMany({ where: { timesheetId: { in: created } } });
  await db.timesheet.deleteMany({ where: { id: { in: created } } });
  await db.notification.deleteMany({ where: { entityId: { in: ids }, createdAt: { gte: since } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids }, createdAt: { gte: since } } });
  await db.attentionItem.deleteMany({ where: { entityId: { in: ids }, createdAt: { gte: since } } });
  await db.activity.deleteMany({ where: { entityId: { in: ids }, createdAt: { gte: since } } });

  const members = await db.companyMember.findMany({ where: { companyId: COMPANY }, select: { id: true, userId: true } });
  await seedTimesheetRecords(db, new Map(members.map((row) => [row.userId, row.id])));
}
