import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import {
  ensureCommitmentForSource,
  settleCommitmentForSource,
} from "@/lib/modules/finance/commitments/commitment.source";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Transaction rollback (PRD #48 §193-§195, §203).
 *
 * The question these answer is the one §203 asks: after a transactional
 * failure, is there any foreign-domain state left behind? They use the real
 * Finance door that Procurement calls, with a real database and a real failure
 * injected after the foreign write has already happened — which is the only
 * arrangement where a missing rollback would show.
 */

const SOURCE = { module: "procurement", entityType: "purchase_order", entityId: "order_rollback_test" } as const;

async function forget() {
  await prisma.commitment.deleteMany({
    where: { sourceModule: SOURCE.module, sourceEntityType: SOURCE.entityType, sourceEntityId: SOURCE.entityId },
  });
}

afterEach(forget);

afterAll(async () => {
  await forget();
  await cleanupSessions();
  await prisma.$disconnect();
});

function draft(context: { companyId: string }) {
  return {
    source: SOURCE,
    projectId: "project_a",
    reference: "PO-ROLLBACK-1",
    description: "Rollback test commitment",
    counterpartyName: "Test Supplier",
    category: "MATERIALS" as const,
    currency: "EUR",
    amount: new Prisma.Decimal("1000.00"),
    expectedDate: null,
    companyId: context.companyId,
  };
}

describe("a failure after a foreign-domain write leaves nothing behind", () => {
  it("rolls the commitment back when the operation fails afterwards (§195, §203)", async () => {
    const context = await loginAs("PROCUREMENT");
    const input = draft(context);

    await expect(
      runInTransaction("test.rollback", async (tx) => {
        await ensureCommitmentForSource(tx, context, input);
        // The source domain's own write fails — a claim somebody else won, a
        // state that moved underneath. Whatever it is, the money must not stay
        // committed (PRD #48 §143).
        throw new AccessError("CONFLICT", "the source record changed");
      }),
    ).rejects.toThrow("the source record changed");

    const left = await prisma.commitment.count({
      where: { sourceModule: SOURCE.module, sourceEntityType: SOURCE.entityType, sourceEntityId: SOURCE.entityId },
    });
    expect(left).toBe(0);
  });

  it("keeps the commitment when the operation succeeds", async () => {
    const context = await loginAs("PROCUREMENT");
    const input = draft(context);

    const created = await runInTransaction("test.commit", (tx) => ensureCommitmentForSource(tx, context, input));
    expect(created.created).toBe(true);

    const row = await prisma.commitment.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("APPROVED");
    expect(row.companyId).toBe(context.companyId);
  });
});

describe("the same operation twice makes one record", () => {
  it("is idempotent by source reference (§197)", async () => {
    const context = await loginAs("PROCUREMENT");
    const input = draft(context);

    const first = await runInTransaction("test.first", (tx) => ensureCommitmentForSource(tx, context, input));
    const second = await runInTransaction("test.second", (tx) => ensureCommitmentForSource(tx, context, input));

    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
    expect(
      await prisma.commitment.count({
        where: { sourceModule: SOURCE.module, sourceEntityType: SOURCE.entityType, sourceEntityId: SOURCE.entityId },
      }),
    ).toBe(1);
  });

  it("refuses a second commitment for one source even under a race (§200, §201)", async () => {
    const context = await loginAs("PROCUREMENT");
    const input = draft(context);

    // Two transactions racing for the same source. The unique index is what
    // decides it, not the read either of them did (PRD #48 §41, §141).
    const outcomes = await Promise.allSettled([
      runInTransaction("test.race.a", (tx) => ensureCommitmentForSource(tx, context, input), { attempts: 1 }),
      runInTransaction("test.race.b", (tx) => ensureCommitmentForSource(tx, context, input), { attempts: 1 }),
    ]);

    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(
      await prisma.commitment.count({
        where: { sourceModule: SOURCE.module, sourceEntityType: SOURCE.entityType, sourceEntityId: SOURCE.entityId },
      }),
    ).toBe(1);
  });

  it("settling twice reports the second call changed nothing (§39, §54)", async () => {
    const context = await loginAs("PROCUREMENT");
    const input = draft(context);
    await runInTransaction("test.setup", (tx) => ensureCommitmentForSource(tx, context, input));

    const first = await runInTransaction("test.settle.1", (tx) => settleCommitmentForSource(tx, context, SOURCE, "CANCELLED"));
    const second = await runInTransaction("test.settle.2", (tx) => settleCommitmentForSource(tx, context, SOURCE, "CANCELLED"));

    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = await prisma.commitment.findFirstOrThrow({ where: { sourceEntityId: SOURCE.entityId } });
    expect(row.status).toBe("CANCELLED");
  });

  it("refuses to reopen a commitment that was cancelled (§132, §133)", async () => {
    const context = await loginAs("PROCUREMENT");
    const input = draft(context);
    await runInTransaction("test.setup", (tx) => ensureCommitmentForSource(tx, context, input));
    await runInTransaction("test.cancel", (tx) => settleCommitmentForSource(tx, context, SOURCE, "CANCELLED"));

    await expect(
      runInTransaction("test.reopen", (tx) => ensureCommitmentForSource(tx, context, input)),
    ).rejects.toThrow(/cannot be reopened/);
  });
});

describe("a foreign company's source is never touched", () => {
  it("scopes the lookup to the caller's company (§48 §11)", async () => {
    const procurement = await loginAs("PROCUREMENT");
    await runInTransaction("test.setup", (tx) => ensureCommitmentForSource(tx, procurement, draft(procurement)));

    // A caller from another company asking about the same source id finds
    // nothing to settle — the row is not theirs to see, let alone move.
    const stranger = { ...procurement, companyId: "company_demo_b" };
    const moved = await runInTransaction("test.foreign", (tx) => settleCommitmentForSource(tx, stranger, SOURCE, "CLOSED"));

    expect(moved).toBe(false);
    const row = await prisma.commitment.findFirstOrThrow({ where: { sourceEntityId: SOURCE.entityId } });
    expect(row.status).toBe("APPROVED");
  });
});
