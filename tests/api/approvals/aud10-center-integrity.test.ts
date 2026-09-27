import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { kpis } from "@/config/kpis";
import { widgets } from "@/config/widgets";
import { AccessError } from "@/lib/access/guards";
import { getApprovalCountsForWorkspace, listApprovalsForWorkspace } from "@/lib/modules/approvals/approvals.group";
import { translateDecisionError, translateSourceError, type ApprovalProvider } from "@/lib/modules/approvals/approvals.provider";
import { approvalProviders } from "@/lib/modules/approvals/approvals.registry";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { decideApproval, getApprovalCounts, getApprovalDetail, listApprovals } from "@/lib/modules/approvals/approvals.service";
import { groupPendingApprovals } from "@/lib/modules/dashboard/dashboard.group";
import { loadPlannedKpi, loadPlannedWidget } from "@/lib/modules/dashboard/dashboard.service";
import { createExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * The Approvals Center tells the truth (AUD-10 §4, §9 — CW-03, CW-04, CW-06; gaps A3, A9, A10).
 *
 * Real PostgreSQL, the real finance domain, real demo identities. Races use a
 * database barrier — a second connection holds the source row's lock and the
 * contenders are released only once Postgres shows them queued — never timing.
 * Every assertion reads the database: the source status, the cycle row, the
 * activity, the audit and the outbox, counted per record.
 */

const PREFIX = "aud10b_";
const locker = new PrismaClient();
const created: string[] = [];
const triggers: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of triggers.splice(0)) await dropFailure(name);
  if (created.length) {
    const cycles = await prisma.financeApproval.findMany({ where: { recordId: { in: created } }, select: { id: true } });
    await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: created } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: created } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: created } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: created } } });
    await prisma.financeApproval.deleteMany({ where: { recordId: { in: created } } });
    await prisma.expense.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
});

afterAll(async () => {
  for (const name of triggers.splice(0)) await dropFailure(name);
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

/* Fixtures ------------------------------------------------------------------ */

const query = (input: Record<string, unknown> = {}) => approvalQuerySchema.parse({ limit: 100, ...input });

/** An expense Finance raises and submits; the CEO and the Owner may decide it, Finance may not. */
async function submittedExpense(netAmount = "1500.00") {
  const finance = await loginAs("FINANCE");
  const expense = await expenses.createExpense(
    finance,
    createExpenseSchema.parse({ projectId: PROJECT.a, expenseDate: "2026-09-01", category: "MATERIALS", description: `${PREFIX}expense`, currency: "EUR", netAmount, taxAmount: "0" }),
  );
  created.push(expense.id);
  await expenses.submitExpense(finance, expense.id);
  const approval = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: expense.id, status: "PENDING" } });
  return { expenseId: expense.id, approvalId: approval.id };
}

/** Everything one decision on an expense writes, counted independently of the service. */
async function trail(expenseId: string) {
  const [expense, cycles, activity, audit, outbox] = await Promise.all([
    prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { status: true } }),
    prisma.financeApproval.findMany({ where: { recordId: expenseId }, select: { status: true, decidedByMemberId: true } }),
    prisma.activity.findMany({ where: { entityId: expenseId, action: { in: ["FINANCE_EXPENSE_APPROVED", "FINANCE_EXPENSE_REJECTED"] } }, select: { action: true } }),
    prisma.auditEvent.findMany({ where: { entityId: expenseId, actionKey: { in: ["APPROVAL_APPROVED", "APPROVAL_REJECTED", "FINANCE_EXPENSE_APPROVED", "FINANCE_EXPENSE_REJECTED"] } }, select: { actionKey: true } }),
    prisma.notificationEventOutbox.findMany({ where: { entityId: expenseId, eventType: { in: ["APPROVAL_APPROVED", "APPROVAL_REJECTED"] } }, select: { eventType: true } }),
  ]);
  return {
    status: expense.status,
    pending: cycles.filter((row) => row.status === "PENDING").length,
    decided: cycles.filter((row) => row.status !== "PENDING"),
    activity: activity.map((row) => row.action).sort(),
    audit: audit.map((row) => row.actionKey).sort(),
    outbox: outbox.map((row) => row.eventType).sort(),
  };
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T,>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

const codeOf = (error: unknown) => (error instanceof AccessError ? ((error.details as { code?: string } | undefined)?.code ?? error.code) : undefined);

/** Backends of this database currently waiting on somebody else's lock. */
async function blockedBackends(): Promise<number> {
  const [{ blocked }] = await locker.$queryRaw<Array<{ blocked: number }>>`
    SELECT count(*)::int AS "blocked" FROM pg_stat_activity
     WHERE "datname" = current_database() AND cardinality(pg_blocking_pids("pid")) > 0`;
  return blocked;
}

/**
 * Starts every command while the expense row is locked on a second connection,
 * waits until Postgres shows `waiters` backends queued, then lets them go.
 */
async function race<T>(
  expenseId: string,
  commands: Array<() => Promise<T>>,
  waiters = commands.length,
  meanwhile?: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<unknown>,
): Promise<Settled<T>[]> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const holding = new Promise<void>((resolve) => (locked = resolve));
  const holder = locker.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "expenses" WHERE "id" = ${expenseId} FOR UPDATE`;
      locked();
      await gate;
      // A change another user commits while the contenders wait.
      if (meanwhile) await meanwhile(tx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await holding;
  const running = commands.map((command) => settle(command()));
  const deadline = Date.now() + 15_000;
  for (;;) {
    const blocked = await blockedBackends();
    if (blocked >= waiters) break;
    if (Date.now() > deadline) {
      release();
      await holder;
      throw new Error(`only ${blocked} of ${waiters} contenders reached the lock`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  release();
  await holder;
  return Promise.all(running);
}

/** A trigger that fails one write of one record, so the rest of the transaction has to roll back with it. */
async function failWrite(name: string, table: string, event: "INSERT" | "UPDATE", when: string) {
  if (!/^[a-z0-9_]+$/.test(name) || !/^[a-z_]+$/.test(table)) throw new Error("unsafe identifier");
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'aud10 injected failure (${name})'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE ${event} ON "${table}" FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${name}_fn()`);
  triggers.push(name);
  return table;
}

const TRIGGER_TABLE = new Map<string, string>();

async function dropFailure(name: string) {
  const table = TRIGGER_TABLE.get(name);
  if (table) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}_fn()`);
}

const literal = (value: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("unsafe literal");
  return `'${value}'`;
};

/** Makes one registered source fail the way a broken module would, for this test only. */
function breakSource(key: "sales" | "finance"): void {
  const provider = approvalProviders.getProvider(key) as ApprovalProvider;
  vi.spyOn(provider, "queue").mockRejectedValue(new Error("injected source failure"));
}

/* CW-03 / A3 — a failed source is never zero ------------------------------ */

describe("a source that fails is reported, never counted as zero (CW-03, A3)", () => {
  it("positive control: with every source answering, the counts are complete", async () => {
    const ceo = await loginAs("CEO");
    const counts = await getApprovalCounts(ceo);
    expect(counts).toMatchObject({ partial: false, unavailable: [], failedProviders: [] });
    const list = await listApprovals(ceo, query({ tab: "waiting" }));
    expect(list.counts).toMatchObject({ partial: false, unavailable: [] });
    expect(list.counts.waiting).toBe(list.items.length);
  });

  it("marks the header counts partial and names the source, whether the header came from the list or its own read", async () => {
    const { approvalId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    breakSource("finance");

    // The unfiltered waiting list: the header is read off the same list.
    const list = await listApprovals(ceo, query({ tab: "waiting" }));
    expect(list.items.some((item) => item.approvalId === approvalId)).toBe(false);
    expect(list.failedProviders.map((source) => source.key)).toEqual(["finance"]);
    expect(list.counts.partial).toBe(true);
    expect(list.counts.unavailable.map((source) => source.key)).toEqual(["finance"]);

    // A filtered list asks for the header separately — before AUD-10 that read's failure was dropped.
    const filtered = await listApprovals(ceo, query({ tab: "history", provider: "procurement" }));
    expect(filtered.failedProviders).toEqual([]);
    expect(filtered.counts.partial).toBe(true);
    expect(filtered.counts.unavailable.map((source) => source.key)).toEqual(["finance"]);

    const counts = await getApprovalCounts(ceo);
    expect(counts).toMatchObject({ partial: true });
    expect(counts.unavailable.map((source) => source.key)).toEqual(["finance"]);
  });

  it("carries the partial state per company in the Group workspace", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const complete = await getApprovalCountsForWorkspace(owner);
    expect(complete.partial).toBe(false);
    expect(complete.byCompany?.every((row) => row.partial === false)).toBe(true);

    breakSource("sales");
    const counts = await getApprovalCountsForWorkspace(owner);
    expect(counts.partial).toBe(true);
    const failedCompanies = new Set(counts.unavailable.map((source) => source.company?.id));
    expect(failedCompanies.size).toBeGreaterThan(0);
    for (const row of counts.byCompany ?? []) expect(row.partial).toBe(failedCompanies.has(row.company.id));
    // The per-company figures still sum to the header, as before.
    expect(counts.waiting).toBe((counts.byCompany ?? []).reduce((sum, row) => sum + row.waiting, 0));

    const list = await listApprovalsForWorkspace(owner, query({ tab: "waiting", provider: "finance" }));
    expect(list.counts.partial).toBe(true);
  });

  it("never shows a dashboard figure of zero, or an empty widget, for a source that failed", async () => {
    const ceo = await loginAs("CEO");
    const whole = await loadPlannedKpi(ceo, kpis.approvalCount);
    const waiting = (await getApprovalCounts(ceo)).waiting;
    // Positive control: the tile is the Center's count, not the length of a five-row list.
    expect(whole).toMatchObject({ value: String(waiting) });
    expect(whole?.incomplete).toBeUndefined();

    breakSource("finance");
    const known = (await getApprovalCounts(ceo)).waiting;
    const partial = await loadPlannedKpi(ceo, kpis.approvalCount);
    expect(partial?.incomplete).toBe(true);
    expect(partial?.value).toBe(known > 0 ? `${known}+` : "—");
    expect(partial?.hint).toContain("Finance could not be loaded");

    const widget = await loadPlannedWidget(ceo, widgets.pendingApprovals);
    expect(widget.payload.kind).toBe("approvals");
    expect("incomplete" in widget.payload && widget.payload.incomplete).toContain("Finance could not be loaded");
  });

  it("makes the Group figure 'at least' and names the company, instead of adding a zero", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const complete = await groupPendingApprovals(owner);
    expect(complete?.incomplete).toBeUndefined();
    expect(complete?.value).toMatch(/^\d+$/);

    breakSource("sales");
    const figure = await groupPendingApprovals(owner);
    expect(figure?.incomplete).toBe(true);
    expect(figure?.value).not.toBe("0");
    expect(figure?.hint).toMatch(/^Incomplete: .*Sales.* could not be loaded\.$/);
    expect(figure?.breakdown?.some((row) => row.incomplete)).toBe(true);
  });
});

/* A9 — only a real "already decided" is reported as one ------------------ */

describe("module refusals keep their meaning (A9)", () => {
  const conflict = (message: string, code?: string) => new AccessError("CONFLICT", message, code ? { code } : undefined);
  const outcome = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => null, (reason: unknown) => reason);
    return { code: codeOf(error), message: (error as Error | null)?.message };
  };

  it("passes on a codeless conflict, even one saying 'already', while the cycle is still pending", async () => {
    const stillPending = async () => ({ status: "PENDING", decidedByMemberId: null, newerPending: false });
    expect(await outcome(translateDecisionError(conflict("This sale is already waiting for approval."), stillPending))).toEqual({
      code: "APPROVAL_SOURCE_CONFLICT",
      message: "This sale is already waiting for approval.",
    });
    expect(await outcome(translateDecisionError(conflict("The reservation this approval was asked for has ended.", "SALE_APPROVAL_STALE"), stillPending))).toEqual({
      code: "SALE_APPROVAL_STALE",
      message: "The reservation this approval was asked for has ended.",
    });
    // Without a re-read, a codeless conflict is still passed on rather than guessed at.
    expect(codeOf((() => { try { translateSourceError(conflict("already")); } catch (error) { return error; } })())).toBe("APPROVAL_SOURCE_CONFLICT");
  });

  it("answers 'already decided' only when the cycle really closed — or 'resubmitted' when a newer one waits", async () => {
    const closed = async () => ({ status: "APPROVED", decidedByMemberId: "m", newerPending: false });
    const resubmitted = async () => ({ status: "RETURNED", decidedByMemberId: "m", newerPending: true });
    expect((await outcome(translateDecisionError(conflict("This proposal is not waiting for a decision."), closed))).code).toBe("APPROVAL_ALREADY_DECIDED");
    expect((await outcome(translateDecisionError(conflict("x", "APPROVAL_ALREADY_DECIDED"), closed))).code).toBe("APPROVAL_ALREADY_DECIDED");
    expect((await outcome(translateDecisionError(conflict("x"), resubmitted))).code).toBe("APPROVAL_SOURCE_CHANGED");
    // The guard's own exact answer is never re-worded.
    expect((await outcome(translateDecisionError(conflict("moved", "APPROVAL_SOURCE_CHANGED"), closed))).code).toBe("APPROVAL_SOURCE_CHANGED");
  });

  it("reports a real module conflict on a pending expense as the module's, not as already decided", async () => {
    const { expenseId, approvalId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    // While the decision waits on the expense row, the expense is withdrawn behind the cycle's back:
    // the module refuses a stale source, and the cycle is still pending.
    const [result] = await race(expenseId, [() => decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null })], 1, (tx) =>
      tx.$executeRaw`UPDATE "expenses" SET "status" = 'CANCELLED' WHERE "id" = ${expenseId}`,
    );
    expect(result.ok).toBe(false);
    const error = !result.ok ? result.error : null;
    expect(error).toBeInstanceOf(AccessError);
    expect((error as AccessError).code).toBe("CONFLICT");
    expect(codeOf(error)).toBe("EXPENSE_STALE");
    const after = await trail(expenseId);
    expect(after).toMatchObject({ status: "CANCELLED", pending: 1, activity: [], audit: [], outbox: [] });
  });
});

/* CW-04 / A10 — one transition under concurrency ------------------------- */

describe("concurrent decisions settle once (CW-04, A10)", () => {
  it("approve against reject on one cycle: exactly one transition, the other told it was already decided", async () => {
    const { expenseId, approvalId } = await submittedExpense();
    const [ceo, owner] = await Promise.all([loginAs("CEO"), loginAs("OWNER")]);
    const results = await race(expenseId, [
      () => decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }),
      () => decideApproval(owner, "finance", approvalId, "REJECT", { note: "aud10 race" }),
    ]);
    const won = results.filter((result) => result.ok);
    const lost = results.filter((result): result is { ok: false; error: unknown } => !result.ok);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(codeOf(lost[0].error)).toBe("APPROVAL_ALREADY_DECIDED");

    const after = await trail(expenseId);
    const approved = results[0].ok;
    expect(after.pending).toBe(0);
    expect(after.decided).toHaveLength(1);
    expect(after.status).toBe(approved ? "APPROVED" : "REJECTED");
    expect(after.decided[0]).toEqual({ status: approved ? "APPROVED" : "REJECTED", decidedByMemberId: approved ? ceo.membershipId : owner.membershipId });
    expect(after.activity).toEqual([approved ? "FINANCE_EXPENSE_APPROVED" : "FINANCE_EXPENSE_REJECTED"]);
    expect(after.audit).toEqual(approved ? ["APPROVAL_APPROVED", "FINANCE_EXPENSE_APPROVED"] : ["APPROVAL_REJECTED", "FINANCE_EXPENSE_REJECTED"]);
    expect(after.outbox).toEqual([approved ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED"]);
  });

  it("two identical requests with one idempotency key: the module decides once, the twin replays its outcome", async () => {
    const { expenseId, approvalId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    const key = `${PREFIX}${Date.now()}_twin`;
    const decide = () => decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }, { idempotencyKey: key });
    // Two waiters: the first request's decision on the expense lock, the twin on the first's reserved receipt.
    const results = await race(expenseId, [decide, decide], 2);
    expect(results.every((result) => result.ok)).toBe(true);
    const values = results.map((result) => (result.ok ? result.value : null))!;
    expect(values.map((value) => value?.outcome)).toEqual(["APPROVED", "APPROVED"]);
    expect(values.map((value) => value?.alreadyApplied).sort()).toEqual([false, true]);

    const after = await trail(expenseId);
    expect(after).toMatchObject({ status: "APPROVED", pending: 0, activity: ["FINANCE_EXPENSE_APPROVED"], audit: ["APPROVAL_APPROVED", "FINANCE_EXPENSE_APPROVED"], outbox: ["APPROVAL_APPROVED"] });
    const receipts = await prisma.approvalDecisionReceipt.findMany({ where: { idempotencyKey: key }, select: { outcome: true, approvalId: true } });
    expect(receipts).toEqual([{ outcome: "APPROVED", approvalId }]);
  });

  it("positive control: without a key, the same person repeating the decision after it landed is told it was applied", async () => {
    const { expenseId, approvalId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    await expect(decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null })).resolves.toMatchObject({ outcome: "APPROVED", alreadyApplied: false });
    await expect(decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null })).resolves.toMatchObject({ outcome: "APPROVED", alreadyApplied: true });
    expect((await trail(expenseId)).outbox).toEqual(["APPROVAL_APPROVED"]);
  });
});

/* CW-06 — a failure after any approval write rolls everything back -------- */

describe("a failure after each approval write rolls the whole decision back (CW-06)", () => {
  const points: Array<{ label: string; table: string; event: "INSERT" | "UPDATE"; when: (ids: { expenseId: string; approvalId: string }) => string }> = [
    { label: "source status", table: "expenses", event: "UPDATE", when: ({ expenseId }) => `NEW."id" = ${literal(expenseId)} AND NEW."status" = 'APPROVED'` },
    { label: "cycle row", table: "finance_approvals", event: "UPDATE", when: ({ approvalId }) => `NEW."id" = ${literal(approvalId)} AND NEW."status" = 'APPROVED'` },
    { label: "outbox intent", table: "notification_event_outbox", event: "INSERT", when: ({ expenseId }) => `NEW."entityId" = ${literal(expenseId)} AND NEW."eventType" = 'APPROVAL_APPROVED'` },
    { label: "approval audit", table: "audit_events", event: "INSERT", when: ({ expenseId }) => `NEW."entityId" = ${literal(expenseId)} AND NEW."actionKey" = 'APPROVAL_APPROVED'` },
    { label: "source audit", table: "audit_events", event: "INSERT", when: ({ expenseId }) => `NEW."entityId" = ${literal(expenseId)} AND NEW."actionKey" = 'FINANCE_EXPENSE_APPROVED'` },
    { label: "activity", table: "activities", event: "INSERT", when: ({ expenseId }) => `NEW."entityId" = ${literal(expenseId)} AND NEW."action" = 'FINANCE_EXPENSE_APPROVED'` },
  ];

  for (const [index, point] of points.entries()) {
    it(`fails at the ${point.label}: nothing of the decision remains, and no success event`, async () => {
      const ids = await submittedExpense();
      const ceo = await loginAs("CEO");
      const name = `aud10b_fail_${index}`;
      TRIGGER_TABLE.set(name, point.table);
      await failWrite(name, point.table, point.event, point.when(ids));

      const key = `${PREFIX}${Date.now()}_fail_${index}`;
      const error = await decideApproval(ceo, "finance", ids.approvalId, "APPROVE", { note: null }, { idempotencyKey: key }).then(() => null, (reason: unknown) => reason);
      expect(error, point.label).not.toBeNull();
      expect(String((error as Error).message)).toContain("aud10 injected failure");

      expect(await trail(ids.expenseId)).toMatchObject({ status: "PENDING_APPROVAL", pending: 1, decided: [], activity: [], audit: [], outbox: [] });
      // The reservation went with it: a retry with the same key decides for real, it does not replay a failure.
      expect(await prisma.approvalDecisionReceipt.count({ where: { idempotencyKey: key } })).toBe(0);

      // Positive control: with the fault gone the same request goes through once, and everything lands together.
      await dropFailure(name);
      triggers.splice(triggers.indexOf(name), 1);
      await expect(decideApproval(ceo, "finance", ids.approvalId, "APPROVE", { note: null }, { idempotencyKey: key })).resolves.toMatchObject({ outcome: "APPROVED", alreadyApplied: false });
      expect(await trail(ids.expenseId)).toMatchObject({
        status: "APPROVED",
        pending: 0,
        activity: ["FINANCE_EXPENSE_APPROVED"],
        audit: ["APPROVAL_APPROVED", "FINANCE_EXPENSE_APPROVED"],
        outbox: ["APPROVAL_APPROVED"],
      });
    });
  }
});

/* CW-02 — the source page and the Center tell one story ------------------ */

describe("a decision on the source page is the Center's truth too (CW-02)", () => {
  it("approved on the expense's own page: the Center's queue, counts, detail, history and the requester's view agree after reload", async () => {
    const { expenseId, approvalId } = await submittedExpense();
    const [ceo, accountant] = await Promise.all([loginAs("CEO"), loginAs("FINANCE")]);
    const before = await getApprovalCounts(ceo);
    expect((await listApprovals(ceo, query({ tab: "waiting" }))).items.some((item) => item.approvalId === approvalId)).toBe(true);

    // The module's own page decides, naming the cycle it showed (the guard every source page now sends).
    await expenses.approveExpense(ceo, expenseId, null, { approvalId });

    const after = await getApprovalCounts(ceo);
    expect(after.waiting).toBe(before.waiting - 1);
    expect((await listApprovals(ceo, query({ tab: "waiting" }))).items.some((item) => item.approvalId === approvalId)).toBe(false);
    expect((await listApprovals(ceo, query({ tab: "approved" }))).items.find((item) => item.approvalId === approvalId)).toMatchObject({ status: "APPROVED", decidedBy: { memberId: ceo.membershipId } });
    const detail = await getApprovalDetail(ceo, "finance", approvalId);
    expect(detail.item).toMatchObject({ status: "APPROVED", canApprove: false, canReject: false });
    expect(detail.history.map((entry) => [entry.action, entry.actor?.memberId ?? null])).toEqual([
      ["Requested", accountant.membershipId],
      ["Approved", ceo.membershipId],
    ]);
    expect((await listApprovals(accountant, query({ tab: "requested" }))).items.find((item) => item.approvalId === approvalId)).toMatchObject({ status: "APPROVED" });
    expect(await trail(expenseId)).toMatchObject({ status: "APPROVED", pending: 0, activity: ["FINANCE_EXPENSE_APPROVED"], outbox: ["APPROVAL_APPROVED"] });

    // The Center then answers the same person's same decision as already applied, and writes nothing.
    await expect(decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null })).resolves.toMatchObject({ outcome: "APPROVED", alreadyApplied: true });
    expect((await trail(expenseId)).outbox).toEqual(["APPROVAL_APPROVED"]);
  });
});

