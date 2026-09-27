import { randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import { expect } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { prisma } from "../../helpers";

/**
 * Shared by the AUD-10 workflow tests (CW-07..CW-13): a real row-lock barrier,
 * injected failures, and refusal assertions. Not a test file.
 *
 * Races use the database's own lock graph, not timing (the AUD-02 pattern,
 * tests/api/tasks/task-reliability.test.ts): a second connection locks the row
 * the contenders must claim and holds it; the commands are started; the test
 * waits until Postgres reports each of them blocked behind that lock
 * (`pg_blocking_pids`), optionally changes the row inside the holding
 * transaction, and then releases it.
 */

export const locker = new PrismaClient();

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

export function codeOf(error: unknown): string | undefined {
  if (!(error instanceof AccessError)) return undefined;
  return (error.details as { code?: string } | undefined)?.code ?? error.code;
}

export async function expectRefusal(promise: Promise<unknown>, code: string): Promise<AccessError> {
  const outcome = await settle(promise);
  expect(outcome.ok, `expected ${code}`).toBe(false);
  const error = (outcome as { error: unknown }).error;
  expect(error, String(error)).toBeInstanceOf(AccessError);
  expect(codeOf(error)).toBe(code);
  return error as AccessError;
}

/**
 * Locks one row of `table` on the locker connection, starts every command,
 * waits until all of them are queued behind that lock, runs `whileHeld` in the
 * holding transaction (to change the row under them), and then commits.
 */
export async function raceBehindRow<T>(
  table: string,
  id: string,
  commands: Array<() => Promise<T>>,
  whileHeld?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<Settled<T>[]> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holding!: (pid: number) => void;
  const holderPid = new Promise<number>((resolve) => (holding = resolve));
  let changeRow!: () => void;
  const changed = new Promise<void>((resolve) => (changeRow = resolve));

  const holder = locker.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
      await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id);
      holding(pid);
      await gate;
      if (whileHeld) await whileHeld(tx);
      changeRow();
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const pid = await holderPid;
  const running = commands.map((command) => settle(command()));
  try {
    await waitForBlocked(pid, commands.length);
  } finally {
    release();
    await changed.catch(() => undefined);
    await holder;
  }
  return Promise.all(running);
}

/** Polls the chain of sessions blocked behind the holder until `count` are queued. */
async function waitForBlocked(holderPid: number, count: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const [{ blocked }] = await locker.$queryRaw<Array<{ blocked: number }>>`
      WITH RECURSIVE "chain"("pid") AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "chain" c ON c."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "blocked" FROM "chain"`;
    if (blocked >= count) return;
    if (Date.now() > deadline) throw new Error(`only ${blocked} of ${count} commands reached the lock`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * A temporary trigger that fails every INSERT or UPDATE on `table` matching
 * `condition` while `run` runs — an injected failure in the middle of a
 * transaction, in this lane only. Always dropped afterwards.
 */
export async function failingWrites(table: string, condition: string, run: () => Promise<void>): Promise<void> {
  const name = `aud10c_fail_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected failure (AUD-10)'; END IF; RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

/** TASK_CREATED history left behind by a task that no longer exists: a rolled-back task must leave none. */
export async function orphanTaskHistory(since: Date): Promise<number> {
  const [{ count }] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS "count" FROM "activities" a
    WHERE a."action" = 'TASK_CREATED' AND a."createdAt" >= ${since}
      AND NOT EXISTS (SELECT 1 FROM "tasks" t WHERE t."id" = a."entityId")`;
  return count;
}

/** Everything a task leaves behind, for cleanup. */
export async function removeTasks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.meetingActionItem.updateMany({ where: { linkedTaskId: { in: ids } }, data: { linkedTaskId: null } });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
}
