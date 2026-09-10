import { PrismaClient } from "@prisma/client";

/**
 * Direct database access for E2E setup and teardown (PRD #9 §126).
 *
 * A spec that changes seeded state must put it back, or the second run of the
 * suite tests a different world from the first. Approving the last pending
 * invoice and leaving it approved is exactly how a suite quietly stops
 * asserting anything.
 */
export const db = new PrismaClient();

/** Returns the approval fixtures to the state the seed documents. */
export async function resetApprovalFixtures(): Promise<void> {
  await db.invoice.updateMany({
    where: { invoiceNumber: { in: ["INV-001", "INV-006"] } },
    data: { status: "PENDING", approvedBy: null, approvedAt: null },
  });

  await db.purchaseRequest.updateMany({
    where: { reference: { in: ["PR-001", "PR-004", "PR-009"] } },
    data: { status: "PENDING_APPROVAL", approvedBy: null, approvedAt: null },
  });

  await db.contract.updateMany({
    where: { reference: { in: ["CTR-003", "CTR-007"] } },
    data: { status: "PENDING_APPROVAL", approvedBy: null, approvedAt: null },
  });
}

/** Removes the projects a spec created, so a rerun starts from the seed. */
export async function removeTestProjects(codePrefix: string): Promise<void> {
  const projects = await db.project.findMany({
    where: { code: { startsWith: codePrefix } },
    select: { id: true },
  });

  if (projects.length === 0) return;
  const ids = projects.map((project) => project.id);

  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
}

/** Removes the tasks a spec created, so a rerun starts from the seed. */
export async function removeTestTasks(titlePrefix: string): Promise<void> {
  const tasks = await db.task.findMany({
    where: { title: { startsWith: titlePrefix } },
    select: { id: true },
  });

  if (tasks.length === 0) return;
  const ids = tasks.map((task) => task.id);

  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.task.deleteMany({ where: { id: { in: ids } } });
}
