import { afterAll, describe, expect, it } from "vitest";

import { applyTransition, assertTransitionAllowed } from "@/lib/core/state/transition";
import { hseHazardMachine } from "@/lib/modules/hse/hazards/hazard.machine";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Guarded transitions against the real database (PRD #49 §258, §271, §272).
 *
 * The claim being tested is narrow and is the whole point of the machine: the
 * state a transition is legal from is part of the write, so two callers who
 * both read the same state cannot both apply it. A mock cannot answer that —
 * only two real transactions meeting on a real row can.
 */

const raised: string[] = [];

async function hazard(companyId: string, memberId: string, status: "OPEN" | "CLOSED" = "OPEN") {
  const row = await prisma.hseHazard.create({
    data: {
      companyId,
      hazardNumber: `TRZ-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      title: "Transition probe",
      description: "Raised by the transition tests.",
      hazardCategory: "OTHER",
      status,
      likelihood: 1,
      severityScore: 1,
      riskScore: 1,
      riskLevel: "LOW",
      observedAt: new Date(),
      reportedByMemberId: memberId,
      createdByMemberId: memberId,
    },
    select: { id: true, status: true },
  });
  raised.push(row.id);
  return row;
}

afterAll(async () => {
  if (raised.length > 0) await prisma.hseHazard.deleteMany({ where: { id: { in: raised } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("a guarded transition", () => {
  it("moves a record that is still where the caller left it", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    const outcome = await runInTransaction("test.transition.move", (tx) =>
      applyTransition(tx, {
        machine: hseHazardMachine,
        action: "control",
        id: row.id,
        context,
        from: "OPEN",
        data: { controlMeasure: "Barrier" },
      }),
    );

    expect(outcome).toBe("MOVED");
    const after = await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
    expect(after.status).toBe("CONTROLLED");
  });

  it("refuses a record somebody else moved first, and changes nothing", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    // Somebody closes it while our caller is still looking at OPEN.
    await prisma.hseHazard.update({ where: { id: row.id }, data: { status: "CLOSED", closedAt: new Date() } });

    await expect(
      runInTransaction("test.transition.stale", (tx) =>
        applyTransition(tx, {
          machine: hseHazardMachine,
          action: "control",
          id: row.id,
          context,
          from: "OPEN",
          data: { controlMeasure: "Barrier" },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { status: true, controlMeasure: true } });
    expect(after.status).toBe("CLOSED");
    expect(after.controlMeasure).toBeNull();
  });

  it("lets exactly one of two simultaneous callers win (§271)", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    // Both read OPEN, both try to control. The guard is in the write, so the
    // second matches no row.
    const results = await Promise.allSettled([
      runInTransaction("test.transition.race.a", (tx) =>
        applyTransition(tx, {
          machine: hseHazardMachine, action: "control", id: row.id,
          context, from: "OPEN", data: { controlMeasure: "A" },
        }),
      ),
      runInTransaction("test.transition.race.b", (tx) =>
        applyTransition(tx, {
          machine: hseHazardMachine, action: "control", id: row.id,
          context, from: "OPEN", data: { controlMeasure: "B" },
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("will not move another company's record (§172)", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    await expect(
      runInTransaction("test.transition.foreign", (tx) =>
        applyTransition(tx, {
          machine: hseHazardMachine,
          action: "control",
          id: row.id,
          // Same person, a context that claims another company: the write is
          // scoped by the context's company, so it matches nothing.
          context: { ...context, companyId: "some-other-company" },
          from: "OPEN",
          data: { controlMeasure: "Barrier" },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
    expect(after.status).toBe("OPEN");
  });

  it("treats a replayed idempotent action as already done, and writes nothing twice (§236)", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    const first = await runInTransaction("test.transition.idempotent.1", (tx) =>
      applyTransition(tx, {
        machine: hseHazardMachine, action: "cancel", id: row.id,
        context, from: "OPEN", idempotent: true,
        data: { cancelledAt: new Date() },
      }),
    );
    const cancelledAt = (await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { cancelledAt: true } })).cancelledAt;

    const second = await runInTransaction("test.transition.idempotent.2", (tx) =>
      applyTransition(tx, {
        machine: hseHazardMachine, action: "cancel", id: row.id,
        context, from: "OPEN", idempotent: true,
        data: { cancelledAt: new Date() },
      }),
    );

    expect(first).toBe("MOVED");
    expect(second).toBe("ALREADY_THERE");
    const after = await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { cancelledAt: true } });
    expect(after.cancelledAt).toEqual(cancelledAt);
  });

  it("raises a conflict rather than replaying when the action is not idempotent", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    await runInTransaction("test.transition.once", (tx) =>
      applyTransition(tx, {
        machine: hseHazardMachine, action: "cancel", id: row.id,
        context, from: "OPEN", data: { cancelledAt: new Date() },
      }),
    );

    await expect(
      runInTransaction("test.transition.twice", (tx) =>
        applyTransition(tx, {
          machine: hseHazardMachine, action: "cancel", id: row.id,
          context, from: "OPEN", data: { cancelledAt: new Date() },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("the transition guard", () => {
  it("refuses an action the machine does not have", async () => {
    const context = await loginAs("HSE");
    expect(() =>
      assertTransitionAllowed(hseHazardMachine, { currentState: "OPEN", action: "vanish" as never, context }),
    ).toThrow(/no action/);
  });

  it("refuses a move that is not legal from the record's state", async () => {
    const context = await loginAs("HSE");
    // Reopening is for a closed hazard; an open one has nothing to reopen.
    expect(() =>
      assertTransitionAllowed(hseHazardMachine, { currentState: "OPEN", action: "reopen", context, reason: "why" }),
    ).toThrow(/cannot be/);
  });

  it("refuses a transition that needs a reason and was given none (§234)", async () => {
    const context = await loginAs("HSE");
    expect(() =>
      assertTransitionAllowed(hseHazardMachine, { currentState: "CLOSED", action: "reopen", context, reason: "  " }),
    ).toThrow(/reason/i);
  });

  it("refuses somebody without the permission the transition names", async () => {
    // A role with no HSE rights at all.
    const context = await loginAs("ADMIN");
    expect(() =>
      assertTransitionAllowed(hseHazardMachine, { currentState: "OPEN", action: "control", context }),
    ).toThrow();
  });
});
