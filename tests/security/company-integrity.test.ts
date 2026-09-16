import { afterAll, describe, expect, it } from "vitest";

import { findCrossCompanyReferences } from "@/lib/core/security/company-integrity";
import { prisma } from "../helpers";
import { COMPANY_A, COMPANY_B } from "./harness/companies";

/**
 * The data-level isolation invariant (PRD #47 §20, §21, §189).
 *
 * The first test is the gate: nothing in the database links one company's
 * record to another's. The second proves the gate can close — a scanner that
 * never finds anything would pass the first test just as well.
 */
const PLANTED = "task_security_integrity_probe";

afterAll(async () => {
  await prisma.task.deleteMany({ where: { id: PLANTED } });
  await prisma.$disconnect();
});

describe("company integrity (PRD #47 §21)", () => {
  it("finds no row that references another company's record", async () => {
    expect(await findCrossCompanyReferences(prisma)).toEqual([]);
  }, 300_000);

  it("finds a planted one: a Company A task assigned to a Company B member", async () => {
    const memberB = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY_B }, select: { id: true } });
    const creatorA = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY_A }, select: { id: true, userId: true } });
    await prisma.task.create({
      data: { id: PLANTED, companyId: COMPANY_A, title: "Integrity probe", assigneeMemberId: memberB.id, createdByMemberId: creatorA.id, createdBy: creatorA.userId },
    });

    const violations = await findCrossCompanyReferences(prisma);
    expect(violations).toContainEqual(expect.objectContaining({ table: "Task", column: "assigneeMemberId", sampleIds: [PLANTED] }));
  }, 300_000);
});
