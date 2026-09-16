import { afterAll, describe, expect, it } from "vitest";

import { defineStateMachine } from "@/lib/core/state/machine";
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
const steps: string[] = [];

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
  if (steps.length > 0) await prisma.approvalStep.deleteMany({ where: { id: { in: steps } } });
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

/**
 * The three things a transition can say beyond one permission and one
 * destination, exercised on a probe machine over the hazard table so they are
 * tested once, here, rather than only through whichever domain uses them first.
 */
type ProbeState = "OPEN" | "CONTROLLED" | "CLOSED" | "CANCELLED";
type ProbeAction = "settle" | "decide" | "either";

const probe = defineStateMachine<ProbeState, ProbeAction>({
  key: "probe_hazard",
  model: "hseHazard",
  field: "status",
  states: ["OPEN", "CONTROLLED", "CLOSED", "CANCELLED"],
  terminal: ["CLOSED", "CANCELLED"],
  transitions: [
    // The record decides where it lands; the service names which.
    { action: "settle", from: ["OPEN"], to: ["CLOSED", "CANCELLED"], permission: "hse.hazard.close" },
    // An approval chain can conclude it for somebody without the permission.
    { action: "decide", from: ["OPEN"], to: "CONTROLLED", permission: "finance.approval.decide", concludedByApprovalStep: true },
    // Any one of these is enough.
    { action: "either", from: ["OPEN"], to: "CONTROLLED", permission: ["finance.approval.decide", "hse.hazard.control"] },
  ],
});

async function decidedStep(companyId: string, decidedByMemberId: string | null, status: "PENDING" | "APPROVED") {
  const row = await prisma.approvalStep.create({
    data: {
      companyId,
      providerKey: "probe",
      approvalId: `probe-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      stepNumber: 1,
      label: "Probe",
      status,
      decidedByMemberId,
      decidedAt: status === "PENDING" ? null : new Date(),
    },
    select: { id: true },
  });
  steps.push(row.id);
  return row.id;
}

describe("a transition with more than one destination", () => {
  it("lands where the service says, provided the machine declares it", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    await runInTransaction("test.transition.destination", (tx) =>
      applyTransition(tx, { machine: probe, action: "settle", id: row.id, context, from: "OPEN", to: "CANCELLED" }),
    );

    const after = await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
    expect(after.status).toBe("CANCELLED");
  });

  it("refuses a destination the machine does not declare, and one left unnamed", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    await expect(
      runInTransaction("test.transition.undeclared", (tx) =>
        applyTransition(tx, { machine: probe, action: "settle", id: row.id, context, from: "OPEN", to: "CONTROLLED" }),
      ),
    ).rejects.toThrow(/does not lead to/);
    await expect(
      runInTransaction("test.transition.unnamed", (tx) =>
        applyTransition(tx, { machine: probe, action: "settle", id: row.id, context, from: "OPEN" }),
      ),
    ).rejects.toThrow(/name which/);

    const after = await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
    expect(after.status).toBe("OPEN");
  });
});

describe("a transition an approval chain concludes", () => {
  it("is refused to somebody with neither the permission nor a step", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    await expect(
      runInTransaction("test.transition.no-authority", (tx) =>
        applyTransition(tx, { machine: probe, action: "decide", id: row.id, context, from: "OPEN" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is applied for the person who decided the step", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);
    const step = await decidedStep(context.companyId, context.membershipId, "APPROVED");

    const outcome = await runInTransaction("test.transition.step", (tx) =>
      applyTransition(tx, { machine: probe, action: "decide", id: row.id, context, from: "OPEN", approvalStepId: step }),
    );

    expect(outcome).toBe("MOVED");
  });

  it("will not take a step somebody else decided, or one still pending", async () => {
    const context = await loginAs("HSE");
    const other = await loginAs("OWNER");
    const row = await hazard(context.companyId, context.membershipId);
    const theirs = await decidedStep(context.companyId, other.membershipId, "APPROVED");
    const pending = await decidedStep(context.companyId, context.membershipId, "PENDING");

    for (const step of [theirs, pending]) {
      await expect(
        runInTransaction("test.transition.foreign-step", (tx) =>
          applyTransition(tx, { machine: probe, action: "decide", id: row.id, context, from: "OPEN", approvalStepId: step }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const after = await prisma.hseHazard.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
    expect(after.status).toBe("OPEN");
  });

  it("does not let a step stand in on a transition that never declared it", async () => {
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);
    const step = await decidedStep(context.companyId, context.membershipId, "APPROVED");

    await expect(
      runInTransaction("test.transition.undeclared-step", (tx) =>
        applyTransition(tx, { machine: probe, action: "settle", id: row.id, context, from: "OPEN", to: "CLOSED", approvalStepId: step }),
      ),
    ).rejects.toThrow(/not concluded by an approval step/);
  });
});

describe("a transition naming several permissions", () => {
  it("is applied for somebody holding any one of them", async () => {
    // HSE holds hse.hazard.control and not finance.approval.decide.
    const context = await loginAs("HSE");
    const row = await hazard(context.companyId, context.membershipId);

    const outcome = await runInTransaction("test.transition.any-of", (tx) =>
      applyTransition(tx, { machine: probe, action: "either", id: row.id, context, from: "OPEN" }),
    );
    expect(outcome).toBe("MOVED");
  });
});
