import { PrismaClient, type Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { prisma } from "../../helpers";

/**
 * Shared by the AUD-10 source-guard tests and by the module suites that decide
 * approvals (AUD-10 §4, CW-02, CW-04, CW-05). Not a test file.
 *
 * Every domain decision now names the approval cycle it decides. A module
 * test that used to call `approveInvoice(owner, id, note)` names what a page
 * showing that record would have shown: the pending cycle, or — for a record
 * with nothing pending — the latest cycle it had, which is exactly what a
 * stale page would send.
 */

export type CycleModule = "finance" | "procurement" | "sales" | "contracts" | "qaqc" | "hse";

type CycleRow = { id: string; status: string };

async function cyclesOf(module: CycleModule, recordId: string): Promise<CycleRow[]> {
  const args = {
    where: { recordId },
    orderBy: [{ submittedAt: "desc" as const }, { createdAt: "desc" as const }],
    take: 10,
    select: { id: true, status: true },
  };
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

/** The cycle (and, in a procurement chain, the step) a page showing this record would name. */
export async function shownCycle(module: CycleModule, recordId: string): Promise<ApprovalGuard & { approvalId: string }> {
  const rows = await cyclesOf(module, recordId);
  const row = rows.find((cycle) => cycle.status === "PENDING") ?? rows[0];
  if (!row) return { approvalId: "aud10_no_cycle_shown" };
  const guard: ApprovalGuard & { approvalId: string } = { approvalId: row.id };
  if (module === "procurement") {
    const step = await prisma.approvalStep.findFirst({
      where: { providerKey: "procurement", approvalId: row.id, status: "PENDING" },
      orderBy: { stepNumber: "asc" },
      select: { stepNumber: true },
    });
    if (step) guard.stepNumber = step.stepNumber;
  }
  return guard;
}

/** The submission a leave page shows: its `submittedAt` stamp (AUD-10 §4, A2). */
export async function shownSubmission(leaveId: string): Promise<{ submittedAt: Date | null }> {
  const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId }, select: { submittedAt: true } });
  return { submittedAt: row.submittedAt };
}

/* -------------------------------------------------------------------------- */
/* Races with a real barrier                                                   */
/* -------------------------------------------------------------------------- */

let lockerClient: PrismaClient | null = null;

/** The second connection that holds the barrier lock; created on first use only. */
function locker(): PrismaClient {
  lockerClient ??= new PrismaClient();
  return lockerClient;
}

export async function disconnectLocker(): Promise<void> {
  await lockerClient?.$disconnect();
  lockerClient = null;
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/**
 * Starts every command while a row they must write is locked on a second
 * connection, waits until Postgres itself shows each one blocked behind that
 * lock (`pg_blocking_pids`, the whole wait chain), then releases it. Timing
 * plays no part: every contender has read the pending cycle and passed its
 * checks before any of them writes (the AUD-02 pattern,
 * tests/api/tasks/task-reliability.test.ts).
 */
export async function raceOnRow<T>(
  table: string,
  rowId: string,
  commands: Array<() => Promise<T>>,
  options: { whileHeld?: (tx: Prisma.TransactionClient) => Promise<void> } = {},
): Promise<Settled<T>[]> {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`not a table name: ${table}`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holding!: (pid: number) => void;
  const holderPid = new Promise<number>((resolve) => (holding = resolve));

  const holder = locker().$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
      await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, rowId);
      holding(pid);
      await gate;
      // A change committed by the lock holder, which the queued contenders only see once it is released.
      if (options.whileHeld) await options.whileHeld(tx);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const pid = await holderPid;
  const running = commands.map((command) => settle(command()));
  try {
    await waitForBlocked(pid, commands.length);
  } finally {
    release();
    await holder;
  }
  return Promise.all(running);
}

/** As `raceOnRow`, with the barrier on a transaction-level advisory lock the contenders take first. */
export async function raceOnAdvisoryLock<T>(key: string, commands: Array<() => Promise<T>>): Promise<Settled<T>[]> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holding!: (pid: number) => void;
  const holderPid = new Promise<number>((resolve) => (holding = resolve));

  const holder = locker().$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      holding(pid);
      await gate;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const pid = await holderPid;
  const running = commands.map((command) => settle(command()));
  try {
    await waitForBlocked(pid, commands.length);
  } finally {
    release();
    await holder;
  }
  return Promise.all(running);
}

async function waitForBlocked(holderPid: number, count: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const [{ blocked }] = await locker().$queryRaw<Array<{ blocked: number }>>`
      WITH RECURSIVE "chain"("pid") AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "chain" c ON c."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "blocked" FROM "chain"`;
    if (blocked >= count) return;
    if (Date.now() > deadline) throw new Error(`only ${blocked} of ${count} decisions reached the lock`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** The stable code a refusal carries: AccessError details.code, or the Center's own `code`. */
export function refusalCode(error: unknown): string | undefined {
  if (error instanceof AccessError) {
    const details = error.details as { code?: string } | undefined;
    return details?.code ?? error.code;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof AccessError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}
