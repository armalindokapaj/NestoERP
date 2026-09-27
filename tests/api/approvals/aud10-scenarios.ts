import type { Prisma } from "@prisma/client";
import { expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import { decideApproval, getApprovalDetail } from "@/lib/modules/approvals/approvals.service";
import { prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { raceOnRow, refusalCode, shownCycle, type CycleModule } from "./aud10-cycles";

/**
 * The source-guard contract, run the same way for every record type a module
 * decides (AUD-10 §4, CW-02, CW-04, CW-05). Not a test file: each
 * `aud10-source-guard*.test.ts` describes its module's record types as
 * scenarios and registers these tests for them.
 *
 * The "source page" is the module's own server action, called exactly as its
 * decision controls call it — with the cycle the page rendered — through the
 * real context resolver (the security harness supplies only the session
 * cookie). Outcomes are read back from the database, never from the service's
 * answer alone: the record, its approval rows, its activity and its outbox.
 */

/** What the page's action answered, normalised: `{ ok }`, or the refusal's stable code. */
export type Outcome = { ok: true } | { ok: false; code?: string; error?: string };

export type SourceScenario = {
  /** "finance invoice", for test names. */
  label: string;
  module: CycleModule;
  /** The Center source that decides this record type. */
  providerKey: string;
  /** The record's own table, locked for the race. */
  sourceTable: string;
  /** Who decides it, and who submits it. */
  approver(): Promise<UserContext>;
  /** A fresh record, submitted: one pending cycle. */
  createSubmitted(): Promise<string>;
  /** The page's Approve, naming the cycle it shows (or none). */
  approve(id: string, cycle: PendingCycle | null | undefined): Promise<Outcome>;
  /** The page's reject/return, naming the cycle it shows, which puts the record back with its author. */
  sendBack(id: string, cycle: PendingCycle | null | undefined): Promise<Outcome>;
  /** The author corrects and resubmits it: a new cycle. */
  resubmit(id: string): Promise<void>;
  /** The record's status column, as the module names it. */
  status(id: string): Promise<string>;
  approvedStatus: string;
  /** The activity action written when it is approved (exactly one per approval). */
  approvedActivity: string;
  /** Where its activity is written, when not on the record itself (an amendment writes on its contract). */
  activityWhere?(id: string): Promise<Prisma.ActivityWhereInput>;
};

async function activityWhere(scenario: Pick<SourceScenario, "activityWhere">, id: string): Promise<Prisma.ActivityWhereInput> {
  return scenario.activityWhere ? scenario.activityWhere(id) : { entityId: id };
}

/** A server action's `{ ok, error, code }` result as an Outcome. */
export function fromAction(result: { ok: boolean; error?: string; code?: string }): Outcome {
  return result.ok ? { ok: true } : { ok: false, code: result.code, error: result.error };
}

/** Calls a page's server action as the given person (the real resolver behind the harness's session). */
export async function asPerson<T>(context: UserContext, action: () => Promise<T>): Promise<T> {
  actAs(context);
  try {
    return await action();
  } finally {
    actAs(null);
  }
}

async function cycleRows(module: CycleModule, recordId: string): Promise<unknown[]> {
  const args = { where: { recordId }, orderBy: { submittedAt: "asc" as const } };
  switch (module) {
    case "finance":
      return prisma.financeApproval.findMany(args);
    case "procurement":
      return prisma.procurementApproval.findMany(args);
    case "sales":
      return prisma.salesApproval.findMany(args);
    case "contracts":
      return prisma.contractApproval.findMany(args);
    case "qaqc":
      return prisma.qualityApproval.findMany(args);
    case "hse":
      return prisma.hseApproval.findMany(args);
  }
}

/** Everything a refused decision must leave exactly as it was. */
export async function snapshot(scenario: Pick<SourceScenario, "module" | "sourceTable" | "activityWhere">, id: string) {
  const [record] = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${scenario.sourceTable}" WHERE "id" = $1`, id);
  const [approvals, steps, activity, outbox] = await Promise.all([
    cycleRows(scenario.module, id),
    prisma.approvalStep.findMany({ where: { approvalId: { in: ((await cycleRows(scenario.module, id)) as Array<{ id: string }>).map((row) => row.id) } }, orderBy: [{ approvalId: "asc" }, { stepNumber: "asc" }] }),
    prisma.activity.count({ where: await activityWhere(scenario, id) }),
    prisma.notificationEventOutbox.count({ where: { entityId: id } }),
  ]);
  return JSON.parse(JSON.stringify({ record, approvals, steps, activity, outbox }, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))) as unknown;
}

/**
 * CW-02, CW-05 and the missing-cycle refusal for one record type, plus CW-04's
 * Center-versus-page race. `cleanup` removes every record the scenario made.
 */
export function sourceGuardTests(scenario: SourceScenario, ids: { track(id: string): void }): void {
  it(`CW-02 ${scenario.label}: the designated approver approves from the source page, naming the cycle it shows`, async () => {
    const approver = await scenario.approver();
    const id = await scenario.createSubmitted();
    ids.track(id);
    const shown = await shownCycle(scenario.module, id);

    const outcome = await scenario.approve(id, shown as PendingCycle);
    expect(outcome, JSON.stringify(outcome)).toEqual({ ok: true });

    expect(await scenario.status(id)).toBe(scenario.approvedStatus);
    const rows = (await cycleRows(scenario.module, id)) as Array<{ id: string; status: string; decidedByMemberId: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: shown.approvalId, decidedByMemberId: approver.membershipId });
    expect(["APPROVED"]).toContain(rows[0].status);
    expect(await prisma.activity.count({ where: { AND: [await activityWhere(scenario, id), { action: scenario.approvedActivity }] } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "APPROVAL_APPROVED" } })).toBe(1);
  });

  it(`CW-05 ${scenario.label}: a page left open across send-back and resubmission cannot decide the new cycle`, async () => {
    const id = await scenario.createSubmitted();
    ids.track(id);
    const first = (await shownCycle(scenario.module, id)) as PendingCycle;

    expect(await scenario.sendBack(id, first)).toEqual({ ok: true });
    await scenario.resubmit(id);
    const second = (await shownCycle(scenario.module, id)) as PendingCycle;
    expect(second.approvalId).not.toBe(first.approvalId);

    // The stale page, still showing the first cycle: refused, nothing written.
    const before = await snapshot(scenario, id);
    const staleApprove = await scenario.approve(id, first);
    expect(staleApprove).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    expect((staleApprove as { error?: string }).error).toMatch(/reload/i);
    const staleSendBack = await scenario.sendBack(id, first);
    expect(staleSendBack).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    expect(await snapshot(scenario, id)).toEqual(before);
    expect(await scenario.status(id)).not.toBe(scenario.approvedStatus);

    // The page reloaded, naming the cycle that is pending now.
    expect(await scenario.approve(id, second)).toEqual({ ok: true });
    expect(await scenario.status(id)).toBe(scenario.approvedStatus);
    // History keeps both cycles: the one sent back and the one approved.
    const rows = (await cycleRows(scenario.module, id)) as Array<{ id: string; status: string }>;
    expect(rows.map((row) => row.id)).toEqual([first.approvalId, second.approvalId]);
    expect(rows[1].status).toBe("APPROVED");
    expect(rows[0].status).not.toBe("PENDING");
  });

  it(`CW-05 ${scenario.label}: a decision that names no cycle is refused before anything is written`, async () => {
    const id = await scenario.createSubmitted();
    ids.track(id);
    const before = await snapshot(scenario, id);
    expect(await scenario.approve(id, undefined)).toMatchObject({ ok: false, code: "APPROVAL_CYCLE_REQUIRED" });
    expect(await scenario.sendBack(id, undefined)).toMatchObject({ ok: false, code: "APPROVAL_CYCLE_REQUIRED" });
    expect(await snapshot(scenario, id)).toEqual(before);

    // Positive control: the same page, naming the cycle, decides it.
    expect(await scenario.approve(id, (await shownCycle(scenario.module, id)) as PendingCycle)).toEqual({ ok: true });
    expect(await scenario.status(id)).toBe(scenario.approvedStatus);
  });

  it(`CW-04 ${scenario.label}: the Center and the source page approving the same cycle at once make one transition`, async () => {
    const approver = await scenario.approver();
    const id = await scenario.createSubmitted();
    ids.track(id);
    const shown = (await shownCycle(scenario.module, id)) as PendingCycle;
    const item = (await getApprovalDetail(approver, scenario.providerKey, shown.approvalId)).item;
    expect(item.canApprove).toBe(true);

    const [center, page] = await raceOnRow<unknown>(scenario.sourceTable, id, [
      () => decideApproval(approver, scenario.providerKey, shown.approvalId, "APPROVE", { note: null, expectedVersion: item.version }),
      () => scenario.approve(id, shown),
    ]);

    const pageOk = page.ok && (page.value as Outcome).ok;
    const centerApplied = center.ok && !(center.value as { alreadyApplied?: boolean }).alreadyApplied;
    // Exactly one of them made the transition.
    expect([pageOk, centerApplied].filter(Boolean)).toHaveLength(1);
    // The other told the truth: a conflict, or — for the Center, the same person asking for the same outcome — "already applied".
    if (pageOk) {
      if (center.ok) expect(center.value).toMatchObject({ alreadyApplied: true });
      else expect(refusalCode(center.error)).toMatch(/(_DECIDED|_STALE|_ILLEGAL_TRANSITION|SOURCE_CONFLICT|^CONFLICT)$/);
    } else {
      // The page's action answers rather than throws: a refusal with the conflict's code.
      if (!page.ok) throw page.error;
      expect((page.value as Outcome).ok).toBe(false);
      // A conflict: the cycle already decided, or the record already moved (the module's own stale/illegal-transition code).
      expect((page.value as { code?: string }).code).toMatch(/(_DECIDED|_STALE|_ILLEGAL_TRANSITION|SOURCE_CONFLICT|^CONFLICT)$/);
    }

    expect(await scenario.status(id)).toBe(scenario.approvedStatus);
    const rows = (await cycleRows(scenario.module, id)) as Array<{ status: string; decidedByMemberId: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "APPROVED", decidedByMemberId: approver.membershipId });
    expect(await prisma.activity.count({ where: { AND: [await activityWhere(scenario, id), { action: scenario.approvedActivity }] } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "APPROVAL_APPROVED" } })).toBe(1);
  });
}
