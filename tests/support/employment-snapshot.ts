import type { PrismaClient } from "@prisma/client";

/**
 * Snapshot and restore of everything an employment change can touch (E-03):
 * the employments of the people concerned, their history rows and scheduled
 * changes, their memberships' department and title, and their department
 * places (E-13). API tests and browser specs share the seeded database, so each one puts it back
 * exactly as the seed left it — rows added are removed, rows closed or
 * superseded are reopened, employments created elsewhere by a transfer are
 * deleted with their history.
 */
export async function snapshotEmploymentsWith(prisma: PrismaClient, employmentIds: string[]): Promise<() => Promise<void>> {
  const seed = await prisma.employeeProfile.findMany({ where: { id: { in: employmentIds } }, select: { personProfileId: true } });
  const personIds = [...new Set(seed.map((row) => row.personProfileId))];
  const profiles = await prisma.employeeProfile.findMany({ where: { personProfileId: { in: personIds } }, omit: { createdAt: true, updatedAt: true } });
  const ids = profiles.map((row) => row.id);
  const [assignments, statuses, changes, users] = await Promise.all([
    prisma.employmentAssignment.findMany({ where: { employeeProfileId: { in: ids } } }),
    prisma.employmentStatusHistory.findMany({ where: { employeeProfileId: { in: ids } } }),
    prisma.employmentChange.findMany({ where: { employeeProfileId: { in: ids } } }),
    prisma.user.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } }),
  ]);
  const userIds = users.map((user) => user.id);
  const [members, places] = await Promise.all([
    prisma.companyMember.findMany({ where: { userId: { in: userIds } }, select: { id: true, departmentId: true, jobTitle: true } }),
    prisma.departmentAssignment.findMany({ where: { userId: { in: userIds } }, select: { id: true, status: true, endsAt: true, endedByUserId: true } }),
  ]);

  return async () => {
    // Rows written since. A correction names the row it replaced; unname it first, so none is refused.
    const newAssignments = { employeeProfileId: { in: ids }, id: { notIn: assignments.map((row) => row.id) } };
    const newStatuses = { employeeProfileId: { in: ids }, id: { notIn: statuses.map((row) => row.id) } };
    await prisma.employmentAssignment.updateMany({ where: newAssignments, data: { correctsId: null } });
    await prisma.employmentAssignment.deleteMany({ where: newAssignments });
    await prisma.employmentStatusHistory.updateMany({ where: newStatuses, data: { correctsId: null } });
    await prisma.employmentStatusHistory.deleteMany({ where: newStatuses });
    await prisma.employmentChange.deleteMany({ where: { employeeProfileId: { in: ids }, id: { notIn: changes.map((row) => row.id) } } });
    // Employments a transfer created in another company, with their history.
    const created = await prisma.employeeProfile.findMany({ where: { personProfileId: { in: personIds }, id: { notIn: ids } }, select: { id: true } });
    if (created.length) {
      const createdIds = created.map((row) => row.id);
      await prisma.employmentAssignment.updateMany({ where: { employeeProfileId: { in: createdIds } }, data: { correctsId: null } });
      await prisma.employmentAssignment.deleteMany({ where: { employeeProfileId: { in: createdIds } } });
      await prisma.employmentStatusHistory.updateMany({ where: { employeeProfileId: { in: createdIds } }, data: { correctsId: null } });
      await prisma.employmentStatusHistory.deleteMany({ where: { employeeProfileId: { in: createdIds } } });
      await prisma.employmentChange.deleteMany({ where: { employeeProfileId: { in: createdIds } } });
      await prisma.employeeProfile.deleteMany({ where: { id: { in: createdIds } } });
    }
    // Rows closed or superseded since, reopened.
    for (const row of assignments) {
      await prisma.employmentAssignment.update({ where: { id: row.id }, data: { endDate: row.endDate, supersededAt: row.supersededAt, supersededByUserId: row.supersededByUserId } });
    }
    for (const row of statuses) {
      await prisma.employmentStatusHistory.update({ where: { id: row.id }, data: { effectiveTo: row.effectiveTo, supersededAt: row.supersededAt, supersededByUserId: row.supersededByUserId } });
    }
    for (const row of changes) {
      await prisma.employmentChange.update({
        where: { id: row.id },
        data: { status: row.status, appliedAt: row.appliedAt, cancelledAt: row.cancelledAt, cancelledByUserId: row.cancelledByUserId, cancelReason: row.cancelReason, failureReason: row.failureReason },
      });
    }
    for (const { id, ...row } of profiles) {
      await prisma.employeeProfile.update({ where: { id }, data: row });
    }
    for (const member of members) {
      await prisma.companyMember.update({ where: { id: member.id }, data: { departmentId: member.departmentId, jobTitle: member.jobTitle } });
    }
    await prisma.departmentAssignment.deleteMany({ where: { userId: { in: userIds }, id: { notIn: places.map((row) => row.id) } } });
    for (const place of places) {
      await prisma.departmentAssignment.update({ where: { id: place.id }, data: { status: place.status, endsAt: place.endsAt, endedByUserId: place.endedByUserId } });
    }
  };
}
