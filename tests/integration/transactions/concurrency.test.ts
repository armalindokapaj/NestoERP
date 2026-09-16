import { afterAll, describe, expect, it } from "vitest";

import { allocateNumber } from "@/lib/core/numbering/numbering.service";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Concurrency (PRD #48 §198-§202, §296).
 *
 * Two people pressing the same button at the same moment, and two workers
 * claiming the same row. Each of these runs the real operations in parallel
 * against the real database, because the whole question is what the database
 * does when two transactions meet — which is exactly what a mock cannot say.
 */

/**
 * A numbering scheme of this test's own, in AUTO mode.
 *
 * The demo company's real schemes are MANUAL — its records carry numbers the
 * seed chose — so allocating against one of those would answer null and prove
 * nothing. This entity type exists nowhere else, so nothing else can touch the
 * sequence while the test is reading it.
 */
const SCHEME = { moduleKey: "sales", entityType: "concurrency_probe" };

async function scheme(companyId: string) {
  return prisma.companyNumberingScheme.upsert({
    where: { companyId_moduleKey_entityType: { companyId, ...SCHEME } },
    update: { mode: "AUTO", nextSequence: 1, prefix: "PROBE", resetSequenceYearly: false },
    create: { companyId, ...SCHEME, mode: "AUTO", prefix: "PROBE", nextSequence: 1, resetSequenceYearly: false },
    select: { id: true },
  });
}

afterAll(async () => {
  await prisma.companyNumberingScheme.deleteMany({ where: SCHEME });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("human numbering under concurrency (§200)", () => {
  it("never issues the same number twice", async () => {
    const context = await loginAs("SALES");
    await scheme(context.companyId);
    const target = { companyId: context.companyId, ...SCHEME };

    // Ten allocations at once. The scheme row is taken with FOR UPDATE, so
    // they serialise on it rather than all reading the same sequence
    // (PRD #24 §102, PRD #48 §138).
    const numbers = await Promise.all(Array.from({ length: 10 }, () => allocateNumber(target)));

    const issued = numbers.filter((number): number is string => number !== null);
    expect(issued.length).toBe(10);
    expect(new Set(issued).size).toBe(10);
  });

  it("allocates inside the caller's transaction, and a rollback gives the number back to nobody (§140)", async () => {
    const context = await loginAs("SALES");
    await scheme(context.companyId);
    const target = { companyId: context.companyId, ...SCHEME };

    const before = await prisma.companyNumberingScheme.findFirstOrThrow({
      where: { companyId: context.companyId, ...SCHEME },
      select: { nextSequence: true },
    });

    await expect(
      runInTransaction("test.numbering.rollback", async (tx) => {
        await allocateNumber(target, { tx });
        throw new Error("the record was never created");
      }),
    ).rejects.toThrow();

    const after = await prisma.companyNumberingScheme.findFirstOrThrow({
      where: { companyId: context.companyId, ...SCHEME },
      select: { nextSequence: true },
    });

    // The sequence is untouched: a rolled-back allocation is not a consumed
    // number. Gaps are allowed, but they come from committed work that was
    // later voided — never from a transaction that failed (PRD #48 §140).
    expect(after.nextSequence).toBe(before.nextSequence);
  });
});

describe("a conditional status write settles once (§49, §199)", () => {
  it("lets exactly one of two concurrent transitions win", async () => {
    const context = await loginAs("PROCUREMENT");

    const request = await prisma.purchaseRequest.create({
      data: {
        companyId: context.companyId,
        requestNumber: `PR-CONCURRENCY-${Date.now()}`,
        title: "Concurrency probe",
        projectId: "project_a",
        status: "DRAFT",
        requestedByMemberId: context.membershipId,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    try {
      // Both transactions ask the database to move the row *from* DRAFT. The
      // second finds nothing to update, which is how a double submit becomes
      // one submission rather than two (PRD #48 §45, §49).
      const move = () =>
        runInTransaction(
          "test.transition",
          async (tx) => {
            const { count } = await tx.purchaseRequest.updateMany({
              where: { id: request.id, status: "DRAFT" },
              data: { status: "PENDING_APPROVAL", submittedAt: new Date() },
            });
            return count;
          },
          { attempts: 1 },
        );

      const [first, second] = await Promise.all([move(), move()]);
      expect([first, second].filter((count) => count === 1)).toHaveLength(1);
      expect([first, second].filter((count) => count === 0)).toHaveLength(1);
    } finally {
      await prisma.purchaseRequest.deleteMany({ where: { id: request.id } });
    }
  });
});

describe("the transaction helper", () => {
  it("does not retry a business conflict (§244)", async () => {
    let attempts = 0;
    await expect(
      runInTransaction("test.no-retry", async () => {
        attempts += 1;
        throw new Error("stale version");
      }),
    ).rejects.toThrow("stale version");

    // A business failure is the caller's intent being out of date. Repeating
    // it would overwrite whatever made it stale.
    expect(attempts).toBe(1);
  });
});
