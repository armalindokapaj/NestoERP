import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";


/**
 * Database contention and pool pressure fail bounded (AUD-07 §5, §7, PS-17).
 *
 * A business transaction that meets a row lock another connection holds, or a
 * pool with no free connection, must end in a controlled error within its
 * deadline — never wait until the other side lets go — and must leave nothing
 * half-written behind. Races use a barrier, not timing (the AUD-02 pattern in
 * tests/api/tasks/task-reliability.test.ts): the test waits until Postgres
 * itself reports the transaction blocked behind the held lock.
 *
 * The application's client is loaded with a two-connection pool so the pool
 * test can exhaust it deterministically; everything else about it — the
 * transaction helper, its defaults, its metrics — is the production code.
 */

/** Aurelia, the seeded demo company (tests/api/jobs/job-harness.ts): importing the harness would create the client first. */
const COMPANY_A = "company_demo_a";
const PREFIX = `aud07_contention_${process.pid}_${Date.now().toString(36)}`;
const base = process.env.DATABASE_URL ?? "";
const pooled = `${base}${base.includes("?") ? "&" : "?"}connection_limit=2&pool_timeout=2`;

const locker = new PrismaClient({ datasourceUrl: base });
let app: typeof import("@/lib/database/prisma").prisma;
let tx: typeof import("@/lib/core/transactions/transaction");
let metrics: typeof import("@/lib/core/observability/metrics");

beforeAll(async () => {
  // Before the first import of the singleton: this file's module graph gets its own client.
  process.env.DATABASE_URL = pooled;
  ({ prisma: app } = await import("@/lib/database/prisma"));
  tx = await import("@/lib/core/transactions/transaction");
  metrics = await import("@/lib/core/observability/metrics");
  process.env.DATABASE_URL = base;
});

afterEach(async () => {
  await locker.notificationEventOutbox.deleteMany({ where: { id: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await app?.$disconnect();
  await locker.$disconnect();
});

let sequence = 0;
async function fixtureRow(): Promise<string> {
  sequence += 1;
  const id = `${PREFIX}_${sequence}`;
  await locker.notificationEventOutbox.create({
    data: {
      id,
      companyId: COMPANY_A,
      eventType: "TASK_ASSIGNED",
      moduleKey: "tasks",
      entityType: "task",
      entityId: "task_002",
      payloadJson: { title: "contention fixture", assigneeMemberId: "member_owner", assignmentVersion: id },
      // Parked far in the future so no dispatcher run on this lane picks it up.
      nextAttemptAt: new Date(Date.parse("2999-01-01T00:00:00.000Z")),
    },
  });
  return id;
}

/** Holds `id`'s row lock on another connection until `release` is called. */
async function holdRowLock(id: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holding!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => (holding = resolve));
  const done = locker.$transaction(
    async (inner) => {
      const [{ pid: backend }] = await inner.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
      await inner.$queryRaw`SELECT "id" FROM "notification_event_outbox" WHERE "id" = ${id} FOR UPDATE`;
      holding(backend);
      await gate;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  return { pid: await pid, release, done };
}

async function blockedBehind(holderPid: number): Promise<number> {
  const [{ blocked }] = await locker.$queryRaw<Array<{ blocked: number }>>`
    SELECT count(*)::int AS "blocked" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))`;
  return blocked;
}

async function waitForBlocked(holderPid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while ((await blockedBehind(holderPid)) < 1) {
    if (Date.now() > deadline) throw new Error("the transaction never reached the held lock");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("AUD-07 PS-17: contention and pool pressure fail bounded", () => {
  it("a transaction blocked on a held row lock ends in a controlled error within its deadline, and writes nothing", async () => {
    const id = await fixtureRow();
    const lock = await holdRowLock(id);
    const failuresBefore = metrics.counterValue(metrics.Metric.TRANSACTION_FAILURE, { operation: "aud07.contention.lock" });

    const started = Date.now();
    const outcome = tx
      .runInTransaction("aud07.contention.lock", async (client) => {
        await client.$executeRaw`UPDATE "notification_event_outbox" SET "attemptCount" = "attemptCount" + 1 WHERE "id" = ${id}`;
        await client.$executeRaw`UPDATE "notification_event_outbox" SET "lastErrorCode" = 'AUD07_PARTIAL' WHERE "id" = ${id}`;
      })
      .then(
        () => ({ ok: true as const, ms: Date.now() - started }),
        (error: unknown) => ({ ok: false as const, error, ms: Date.now() - started }),
      );

    let settled: Awaited<typeof outcome>;
    let stillWaiting: number;
    try {
      await waitForBlocked(lock.pid);
      settled = await outcome;
      // Measured while the holder still holds: nothing is left queued behind the lock once the helper gave up.
      stillWaiting = await blockedBehind(lock.pid);
    } finally {
      lock.release();
      await lock.done;
    }
    // The helper's deadline ended it, not the holder letting go.
    expect(settled.ok).toBe(false);
    expect(settled.ms).toBeLessThan(tx.TRANSACTION_DEADLINE_MS + 2_000);
    expect(tx.isContention(settled.ok ? null : settled.error)).toBe(true);
    expect(metrics.counterValue(metrics.Metric.TRANSACTION_FAILURE, { operation: "aud07.contention.lock" })).toBe(failuresBefore + 1);
    expect(stillWaiting).toBe(0);
    const row = await locker.notificationEventOutbox.findUniqueOrThrow({ where: { id }, select: { attemptCount: true, lastErrorCode: true } });
    // Atomic: neither statement of the abandoned transaction survived.
    expect(row).toEqual({ attemptCount: 0, lastErrorCode: null });

    // And the same operation succeeds at once when nothing holds the row.
    await tx.runInTransaction("aud07.contention.lock", (client) => client.$executeRaw`UPDATE "notification_event_outbox" SET "attemptCount" = 1 WHERE "id" = ${id}`);
    expect((await locker.notificationEventOutbox.findUniqueOrThrow({ where: { id } })).attemptCount).toBe(1);
  });

  it("a typed ORM write blocked on the same lock is bounded and recognisable too", async () => {
    const id = await fixtureRow();
    const lock = await holdRowLock(id);
    const started = Date.now();
    const outcome = tx
      .runInTransaction("aud07.contention.typed", (client) => client.notificationEventOutbox.update({ where: { id }, data: { attemptCount: { increment: 1 } } }))
      .then(() => null, (error: unknown) => error);
    let error: unknown;
    try {
      await waitForBlocked(lock.pid);
      error = await outcome;
    } finally {
      lock.release();
      await lock.done;
    }
    expect(Date.now() - started).toBeLessThan(tx.TRANSACTION_DEADLINE_MS + 2_000);
    expect(tx.isContention(error)).toBe(true);
    expect((await locker.notificationEventOutbox.findUniqueOrThrow({ where: { id } })).attemptCount).toBe(0);
  });

  it("an exhausted pool refuses a new transaction within maxWait instead of queueing forever", async () => {
    // Both of the pool's connections are held by open transactions.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let opened = 0;
    let bothOpen!: () => void;
    const ready = new Promise<void>((resolve) => (bothOpen = resolve));
    const holders = [1, 2].map(() =>
      app.$transaction(
        async (inner) => {
          await inner.$queryRaw`SELECT 1`;
          opened += 1;
          if (opened === 2) bothOpen();
          await gate;
        },
        { timeout: 30_000, maxWait: 10_000 },
      ),
    );
    await ready;

    const started = Date.now();
    const refused = await tx.runInTransaction("aud07.contention.pool", (client) => client.$queryRaw`SELECT 1`).then(
      () => null,
      (error: unknown) => error,
    );
    const waited = Date.now() - started;
    // Refused, not queued: within maxWait plus the pool's own wait, far inside the 10 s read deadline.
    expect(refused).not.toBeNull();
    expect(tx.isContention(refused)).toBe(true);
    expect(waited).toBeLessThan(tx.TRANSACTION_MAX_WAIT_MS + 3_000);

    release();
    await Promise.all(holders);
    // The pool recovers: the next transaction runs.
    await expect(tx.runInTransaction("aud07.contention.pool", (client) => client.$queryRaw`SELECT 1`)).resolves.toBeDefined();
  });
});
