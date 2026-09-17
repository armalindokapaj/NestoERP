import { db } from "./db";

/**
 * Platform implementation fixtures for E2E (E-06 §20, §21, §70).
 *
 * The spec creates a whole group. Afterwards it goes with everything its
 * implementation wrote: companies and their configuration, the roster's people,
 * logins, memberships and positions, and the group-level audit.
 */
export async function removePlatformGroup(slug: string): Promise<void> {
  const group = await db.parentGroup.findUnique({ where: { slug }, select: { id: true } });
  if (!group) return;
  const parentGroupId = group.id;
  const companies = await db.company.findMany({ where: { parentGroupId }, select: { id: true } });
  const people = await db.personProfile.findMany({ where: { parentGroupId }, select: { id: true } });
  const users = await db.user.findMany({ where: { personProfileId: { in: people.map((row) => row.id) } }, select: { id: true } });
  const userIds = users.map((row) => row.id);

  for (const { id: companyId } of companies) {
    await db.projectMember.deleteMany({ where: { companyId } });
    await db.project.deleteMany({ where: { companyId } });
    await db.mailDelivery.deleteMany({ where: { companyId } });
    await db.auditEvent.deleteMany({ where: { companyId } });
    await db.activity.deleteMany({ where: { companyId } });
    await db.session.deleteMany({ where: { currentCompanyId: companyId } });
    await db.companyInvite.deleteMany({ where: { companyId } });
    await db.department.updateMany({ where: { companyId }, data: { managerMemberId: null } });
    await db.companyMember.deleteMany({ where: { companyId } });
    await db.companyNumberingScheme.deleteMany({ where: { companyId } });
    await db.companyStorageQuota.deleteMany({ where: { companyId } });
    await db.financeSettings.deleteMany({ where: { companyId } });
    await db.companyIntegrationSettings.deleteMany({ where: { companyId } });
    await db.companySettings.deleteMany({ where: { companyId } });
    await db.companyModule.deleteMany({ where: { companyId } });
    await db.departmentAssignment.deleteMany({ where: { companyId } });
    await db.department.deleteMany({ where: { companyId } });
    await db.projectType.deleteMany({ where: { companyId } });
    await db.projectUnitType.deleteMany({ where: { companyId } });
    await db.company.delete({ where: { id: companyId } });
  }
  await db.departmentAssignment.deleteMany({ where: { parentGroupId } });
  await db.parentGroupMember.deleteMany({ where: { parentGroupId } });
  await db.auditEvent.deleteMany({ where: { parentGroupId } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.personProfile.deleteMany({ where: { parentGroupId } });
  await db.groupDepartment.deleteMany({ where: { parentGroupId } });
  await db.parentGroup.delete({ where: { id: parentGroupId } });
}
