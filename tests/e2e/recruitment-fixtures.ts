import { RECRUITMENT_SEED, seedRecruitmentRecords } from "../../prisma/seed/recruitment";
import { db } from "./db";

/**
 * Recruitment and provisioning fixtures for E2E (E-06 §56-§58, §62, §64).
 *
 * The specs create a candidate and accounts. Afterwards the people they added go
 * with their candidacies, employments and requests; the accounts provisioning
 * made go with their memberships and positions; and the seeded lifecycle —
 * Elira interviewing, Adrian approved without a login, Ermira provisioned — is
 * written back exactly as the seed leaves it.
 */

export { RECRUITMENT_SEED };

export const RECRUITMENT_PREFIX = "E2E Recruit";

export async function restoreRecruitment(since: Date): Promise<void> {
  const people = await db.personProfile.findMany({ where: { lastName: { startsWith: RECRUITMENT_PREFIX } }, select: { id: true } });
  const personIds = people.map((row) => row.id);
  const users = await db.user.findMany({
    where: { OR: [{ personProfileId: { in: [...personIds, RECRUITMENT_SEED.selected.person] } }, { username: { startsWith: "adrian.kola" } }] },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);

  await seedRecruitmentRecords(db);
  const requests = await db.userProvisioningRequest.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const members = await db.companyMember.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const assignments = await db.departmentAssignment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const candidates = await db.candidateProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const trail = [...requests, ...assignments, ...candidates].map((row) => row.id).concat(personIds, RECRUITMENT_SEED.selected.request);

  await db.auditEvent.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: since } } });
  await db.activity.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: since } } });
  await db.userProvisioningRequest.deleteMany({ where: { id: { in: requests.map((row) => row.id) } } });
  await db.employeeProfile.updateMany({ where: { companyMemberId: { in: members.map((row) => row.id) } }, data: { companyMemberId: null } });
  await db.departmentAssignment.deleteMany({ where: { id: { in: assignments.map((row) => row.id) } } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.notification.deleteMany({ where: { recipientMemberId: { in: members.map((row) => row.id) } } });
  await db.companyMember.deleteMany({ where: { id: { in: members.map((row) => row.id) } } });
  await db.candidateProfile.deleteMany({ where: { personProfileId: { in: personIds } } });
  await db.employeeProfile.deleteMany({ where: { personProfileId: { in: personIds } } });
  await db.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.personProfile.deleteMany({ where: { id: { in: personIds } } });
}
