import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { databaseNow } from "@/lib/database/clock";
import { prisma as client } from "@/lib/database/prisma";
import { hashSubject } from "@/lib/core/security/rate-limit";
import { hitThrottle, THROTTLE_PURGE_BATCH, THROTTLES } from "@/lib/core/security/throttle";
import { prisma } from "../../helpers";
import { invokeJob } from "./job-harness";

/**
 * `security.throttle-purge` (PRD #38 §17, PRD #51 §132-§136, §159, §160).
 *
 * Buckets are written with this file's prefix, their windows set against the
 * database's clock, and removed after each test. A purge also removes every
 * other closed window in the test database, which is what it is for.
 */

const JOB = "security.throttle-purge";
const PREFIX = `jobtest_throttle_${process.pid}_${Date.now().toString(36)}`;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SUBJECT = `${PREFIX}@example.test`;

/** A bucket whose window ends `offsetMs` from the database's now. */
async function bucket(name: string, offsetMs: number): Promise<void> {
  const now = await databaseNow();
  await prisma.rateLimitBucket.create({ data: { key: `${PREFIX}:${name}`, count: 3, windowEndsAt: new Date(now.getTime() + offsetMs) } });
}

const left = async () =>
  (await prisma.rateLimitBucket.findMany({ where: { key: { startsWith: `${PREFIX}:` } }, select: { key: true }, orderBy: { key: "asc" } })).map((row) =>
    row.key.slice(PREFIX.length + 1),
  );

const subjectKey = async () => `INVITE_RESEND:invite:${await hashSubject(SUBJECT)}`;

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await prisma.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: `${PREFIX}:` } }, { key: await subjectKey() }] } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("security.throttle-purge", () => {
  describe("idempotency", () => {
    it("removes a closed window once and never a live one", async () => {
      await bucket("closed", -MINUTE);
      await bucket("live", 10 * MINUTE);

      const first = await invokeJob(JOB);
      expect(first.processed).toBeGreaterThanOrEqual(1);
      expect(await left()).toEqual(["live"]);

      await invokeJob(JOB);
      expect(await left()).toEqual(["live"]);
    });
  });

  describe("database clock", () => {
    it("keeps a lockout still in force by the database's clock when the worker's own clock runs ahead (§160)", async () => {
      await bucket("live", 10 * MINUTE);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 3 * HOUR);

      await invokeJob(JOB);

      vi.useRealTimers();
      expect(await left()).toEqual(["live"]);
    });

    it("writes a window's end in UTC on the database's clock, so the retry hint and the purge agree with it (§159)", async () => {
      const { limit, windowMs } = THROTTLES.INVITE_RESEND.invite;
      for (let attempt = 0; attempt < limit; attempt += 1) await hitThrottle("INVITE_RESEND", { invite: SUBJECT });
      const refused = await hitThrottle("INVITE_RESEND", { invite: SUBJECT });

      const row = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: await subjectKey() } });
      const endsInMs = row.windowEndsAt.getTime() - (await databaseNow()).getTime();
      expect(endsInMs).toBeGreaterThan(windowMs - MINUTE);
      expect(endsInMs).toBeLessThanOrEqual(windowMs);
      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(windowMs / 1000);

      await invokeJob(JOB);
      expect(await prisma.rateLimitBucket.count({ where: { key: await subjectKey() } })).toBe(1);
    });
  });

  describe("failure", () => {
    it("a purge that fails is reported, not swallowed, and the next run finishes it", async () => {
      await bucket("closed", -MINUTE);
      await bucket("live", 10 * MINUTE);
      vi.spyOn(client, "$executeRaw").mockRejectedValueOnce(new Error("connection reset while purging"));

      await expect(invokeJob(JOB)).rejects.toThrow("connection reset while purging");
      expect(await left()).toEqual(["closed", "live"]);

      vi.restoreAllMocks();
      await invokeJob(JOB);
      expect(await left()).toEqual(["live"]);
    });

    it("stops between batches when the run is told to stop, and the next run removes the rest (§57, §133, §136)", async () => {
      const now = await databaseNow();
      await prisma.rateLimitBucket.createMany({
        data: Array.from({ length: THROTTLE_PURGE_BATCH + 200 }, (_, index) => ({ key: `${PREFIX}:closed-${index}`, count: 1, windowEndsAt: new Date(now.getTime() - HOUR) })),
      });
      const controller = new AbortController();
      const executeRaw = client.$executeRaw.bind(client);
      vi.spyOn(client, "$executeRaw").mockImplementation(((...args: Parameters<typeof executeRaw>) =>
        executeRaw(...args).then((count) => {
          controller.abort();
          return count;
        })) as never);

      await invokeJob(JOB, { signal: controller.signal });

      const closed = () => prisma.rateLimitBucket.count({ where: { key: { startsWith: `${PREFIX}:closed-` } } });
      expect(await closed()).toBeGreaterThanOrEqual(200);
      expect(await closed()).toBeLessThan(THROTTLE_PURGE_BATCH + 200);

      vi.restoreAllMocks();
      await invokeJob(JOB);
      expect(await closed()).toBe(0);
    });
  });
});
