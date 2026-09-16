import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { databaseNow } from "@/lib/database/clock";
import { classifyJobError, JobError } from "@/lib/core/jobs/job.errors";
import { manualRunRefusal } from "@/lib/core/jobs/job.manual";
import type { JobContext, JobDefinition, JobHandler } from "@/lib/core/jobs/job.registry";
import { claimJob, extendJobLease, retryDelaySeconds, runDueJobs, runJobIfDue } from "@/lib/core/jobs/job.runner";
import { forEachCompany } from "@/lib/core/jobs/system-context";
import { runWorker } from "@/lib/core/jobs/worker.loop";
import { liveWorkers, markWorkerProcess, registerWorkerProcess } from "@/lib/core/jobs/worker.process";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B } from "./job-harness";

/**
 * The runner's contract (PRD #51 §23-§35, §55-§59, §116, §176-§179, §196, §197).
 *
 * Every job here is a synthetic one with its own key, run through the real
 * claim, lease, timeout, retry and shutdown code against the real database —
 * the registered jobs' own behaviour is in their contract files beside this one.
 */

const PREFIX = `test.runner-${process.pid}-${Date.now().toString(36)}`;
let counter = 0;
const workerIds: string[] = [];

function testJob(overrides: Partial<JobDefinition> = {}): JobDefinition {
  counter += 1;
  return {
    key: `${PREFIX}-${counter}`,
    owner: "core/jobs",
    purpose: "runner test",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: 60,
    leaseSeconds: 30,
    timeoutSeconds: 30,
    staleAfterSeconds: 600,
    retry: { maxAttempts: 3, initialDelaySeconds: 10, maxDelaySeconds: 100 },
    concurrency: "SINGLETON",
    companyScope: "PLATFORM",
    suspendedCompanies: "NOT_APPLICABLE",
    idempotencyKey: "test",
    catchUp: "test",
    criticality: "LOW",
    enabled: true,
    dryRun: true,
    ...overrides,
  };
}

function worker(name: string): string {
  const id = `${PREFIX}:${name}`;
  workerIds.push(id);
  return id;
}

const heartbeat = (job: JobDefinition) => prisma.workerHeartbeat.findUniqueOrThrow({ where: { job: job.key } });
const secondsFromNow = async (date: Date | null) => (date ? (date.getTime() - (await databaseNow()).getTime()) / 1000 : null);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A handler that resolves only when its run is told to stop. */
const untilAborted = (context: JobContext) =>
  new Promise<never>((_, reject) => context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true }));

afterEach(async () => {
  await prisma.workerHeartbeat.deleteMany({ where: { job: { startsWith: PREFIX } } });
  await prisma.jobFailure.deleteMany({ where: { jobKey: { startsWith: PREFIX } } });
  await prisma.workerProcess.deleteMany({ where: { workerId: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("claim and lease (§23-§28)", () => {
  it("lets one worker at a time claim a job", async () => {
    const job = testJob();
    expect(await claimJob(job, worker("a"))).not.toBeNull();
    expect(await claimJob(job, worker("b"))).toBeNull();
  });

  it("does not claim a job before it is due, unless forced — and never from under a live lease", async () => {
    const job = testJob();
    const handlers = { [job.key]: async () => ({ processed: 1 }) };
    expect((await runJobIfDue(job, worker("a"), { handlers })).status).toBe("success");
    expect(await claimJob(job, worker("b"))).toBeNull();

    const forced = await claimJob(job, worker("b"), { force: true });
    expect(forced).not.toBeNull();
    expect(await claimJob(job, worker("c"), { force: true })).toBeNull();
  });

  it("takes over a job whose worker died holding it, and records the lease expiry", async () => {
    const job = testJob();
    const dead = worker("dead");
    expect(await claimJob(job, dead)).not.toBeNull();
    // The worker died: nothing extends its lease, and it runs out.
    await prisma.workerHeartbeat.update({ where: { job: job.key }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    const outcome = await runJobIfDue(job, worker("survivor"), { handlers: { [job.key]: async () => ({ processed: 2 }) } });
    expect(outcome.status).toBe("success");
    const failures = await prisma.jobFailure.findMany({ where: { jobKey: job.key } });
    expect(failures.map((failure) => failure.errorCode)).toEqual(["LEASE_EXPIRED"]);
    expect(failures[0].errorMessage).toContain(dead);
  });

  it("extends a lease it holds, and learns when it no longer holds one", async () => {
    const job = testJob({ leaseSeconds: 30 });
    const a = worker("a");
    await claimJob(job, a);
    await prisma.workerHeartbeat.update({ where: { job: job.key }, data: { leaseExpiresAt: new Date(Date.now() + 5_000) } });
    expect(await extendJobLease(job, a)).toBe(true);
    expect(await secondsFromNow((await heartbeat(job)).leaseExpiresAt)).toBeGreaterThan(25);

    await prisma.workerHeartbeat.update({ where: { job: job.key }, data: { leaseOwner: "someone-else" } });
    expect(await extendJobLease(job, a)).toBe(false);
  });

  it("stops a run whose lease was taken by another worker, and records nothing over the new holder's", async () => {
    // A three-second lease is extended every second.
    const job = testJob({ leaseSeconds: 3 });
    const a = worker("a");
    const run = runJobIfDue(job, a, { handlers: { [job.key]: untilAborted }, abandonAfterMs: 2_000 });
    await sleep(300);
    await prisma.workerHeartbeat.update({ where: { job: job.key }, data: { leaseOwner: "new-holder" } });

    const outcome = await run;
    expect(outcome.status).toBe("lease_lost");
    expect(outcome.errorCode).toBe("LEASE_EXPIRED");
    const row = await heartbeat(job);
    expect(row.leaseOwner).toBe("new-holder");
    expect(row.runs).toBe(0);
  });
});

describe("timeout (§55, §56)", () => {
  it("aborts a run past its timeout, records TIMEOUT and releases the lease when the handler stops", async () => {
    const job = testJob({ timeoutSeconds: 1 });
    const outcome = await runJobIfDue(job, worker("a"), { handlers: { [job.key]: untilAborted } });
    expect(outcome.status).toBe("failure");
    expect(outcome.errorCode).toBe("TIMEOUT");
    const row = await heartbeat(job);
    expect(row.timeouts).toBe(1);
    expect(row.leaseOwner).toBeNull();
    expect(await prisma.jobFailure.count({ where: { jobKey: job.key, errorCode: "TIMEOUT" } })).toBe(1);
  });

  it("abandons a handler that ignores its signal, and leaves the lease to expire rather than hand it over underneath", async () => {
    const job = testJob({ timeoutSeconds: 1 });
    const a = worker("a");
    const stubborn: JobHandler = async () => {
      await sleep(3_000);
      return { processed: 1 };
    };
    const outcome = await runJobIfDue(job, a, { handlers: { [job.key]: stubborn }, abandonAfterMs: 200 });
    expect(outcome.errorCode).toBe("TIMEOUT");
    const row = await heartbeat(job);
    expect(row.leaseOwner).toBe(a);
    expect(await claimJob(job, worker("b"), { force: true })).toBeNull();
  });
});

describe("retry (§30-§35, §177, §178)", () => {
  it("backs off a failed run by the job's policy, with jitter, and keeps the failure", async () => {
    const job = testJob({ retry: { maxAttempts: 3, initialDelaySeconds: 10, maxDelaySeconds: 100 } });
    const outcome = await runJobIfDue(job, worker("a"), {
      handlers: {
        [job.key]: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    });
    expect(outcome.status).toBe("failure");

    const row = await heartbeat(job);
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastErrorCode).toBe("NETWORK");
    expect(row.leaseOwner).toBeNull();
    const wait = await secondsFromNow(row.nextRunAt);
    expect(wait).toBeGreaterThanOrEqual(7);
    expect(wait).toBeLessThanOrEqual(13);
    expect(await prisma.jobFailure.count({ where: { jobKey: job.key, sourceType: "job" } })).toBe(1);
  });

  it("recovers from a transient failure: the next run succeeds and clears the streak", async () => {
    const job = testJob();
    let calls = 0;
    const flaky: JobHandler = async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket hang up");
      return { processed: 3 };
    };
    expect((await runJobIfDue(job, worker("a"), { handlers: { [job.key]: flaky } })).status).toBe("failure");
    expect((await runJobIfDue(job, worker("a"), { handlers: { [job.key]: flaky }, force: true })).status).toBe("success");

    const row = await heartbeat(job);
    expect(row).toMatchObject({ consecutiveFailures: 0, successes: 1, failures: 1, retries: 1, started: 2, lastProcessed: 3 });
  });

  it("is FAILED after its maximum attempts, and waits for its schedule instead of retrying early", async () => {
    const job = testJob({ intervalSeconds: 600, retry: { maxAttempts: 2, initialDelaySeconds: 5, maxDelaySeconds: 50 } });
    const failing = { [job.key]: async () => Promise.reject(new ZodError([])) };
    await runJobIfDue(job, worker("a"), { handlers: failing });
    await runJobIfDue(job, worker("a"), { handlers: failing, force: true });

    const row = await heartbeat(job);
    expect(row.consecutiveFailures).toBe(2);
    expect(row.lastErrorCode).toBe("VALIDATION");
    const wait = await secondsFromNow(row.nextRunAt);
    expect(wait).toBeGreaterThan(590);
    expect(await prisma.jobFailure.count({ where: { jobKey: job.key } })).toBe(2);
  });

  it("doubles the delay per failure up to the cap, and never below the jitter floor", () => {
    const job = testJob({ intervalSeconds: 3600, retry: { maxAttempts: 6, initialDelaySeconds: 10, maxDelaySeconds: 60 } });
    const middle = () => 0.5;
    expect([1, 2, 3, 4, 5].map((failures) => retryDelaySeconds(job, failures, middle))).toEqual([10, 20, 40, 60, 60]);
    expect(retryDelaySeconds(job, 1, () => 0)).toBe(8);
    expect(retryDelaySeconds(job, 1, () => 1)).toBe(12);
    expect(retryDelaySeconds(job, 6, middle)).toBe(3600);
  });

  it("classifies what cannot succeed on a retry as permanent", () => {
    expect(classifyJobError(new ZodError([])).retryable).toBe(false);
    expect(classifyJobError(new JobError("STATE_CONFLICT", "moved")).retryable).toBe(false);
    expect(classifyJobError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toMatchObject({ code: "NETWORK", retryable: true });
  });
});

describe("manual runs (§163-§166)", () => {
  it("gives a dry run the flag, and leaves when the job is next due untouched", async () => {
    const job = testJob();
    let seen: boolean | null = null;
    await runJobIfDue(job, worker("a"), { handlers: { [job.key]: async () => ({ processed: 0 }) } });
    const before = await heartbeat(job);

    const outcome = await runJobIfDue(job, worker("a"), {
      force: true,
      dryRun: true,
      handlers: {
        [job.key]: async (context) => {
          seen = context.dryRun;
          return { processed: 4 };
        },
      },
    });
    expect(outcome).toMatchObject({ status: "success", dryRun: true, processed: 4 });
    expect(seen).toBe(true);
    const after = await heartbeat(job);
    expect(after.nextRunAt?.getTime()).toBe(before.nextRunAt?.getTime());
    expect(after.lastSuccessAt?.getTime()).toBe(before.lastSuccessAt?.getTime());
  });

  it("never hands --dry-run to a job that does not support it", async () => {
    const job = testJob({ dryRun: false });
    let seen: boolean | null = null;
    await runJobIfDue(job, worker("a"), {
      dryRun: true,
      handlers: {
        [job.key]: async (context) => {
          seen = context.dryRun;
          return { processed: 0 };
        },
      },
    });
    expect(seen).toBe(false);
  });

  it("keeps a company-scoped run to the companies the operator named", async () => {
    const job = testJob({ companyScope: "COMPANY", suspendedCompanies: "SKIPPED" });
    const visited: string[] = [];
    await runJobIfDue(job, worker("a"), {
      companyIds: [COMPANY_B],
      handlers: {
        [job.key]: async () => {
          await forEachCompany(job.key, async (system) => {
            visited.push(system.companyId);
          });
          return { processed: visited.length };
        },
      },
    });
    expect(visited).toEqual([COMPANY_B]);
  });

  it("runs a MANUAL job only when asked", async () => {
    const job = testJob({ trigger: "MANUAL", intervalSeconds: 0 });
    let runs = 0;
    const handlers = {
      [job.key]: async () => {
        runs += 1;
        return { processed: 0 };
      },
    };
    await runDueJobs(["scheduled"], worker("a"), { jobs: [job], handlers });
    expect(runs).toBe(0);
    expect((await runJobIfDue(job, worker("a"), { handlers, force: true })).status).toBe("success");
    expect(runs).toBe(1);
    expect((await heartbeat(job)).nextRunAt).toBeNull();
  });

  it("refuses what an operator cannot ask of a job before claiming anything (§164, §165)", () => {
    expect(manualRunRefusal(testJob({ dryRun: false }), { dryRun: true })).toMatch(/does not support a dry run/);
    expect(manualRunRefusal(testJob({ companyScope: "PLATFORM", suspendedCompanies: "NOT_APPLICABLE" }), { companyIds: [COMPANY_A] })).toMatch(
      /PLATFORM-scoped/,
    );
    expect(manualRunRefusal(testJob({ requires: "scanner" }), { capabilities: { scanner: false } })).toMatch(/no malware scanner configured/);
    expect(manualRunRefusal(testJob({ companyScope: "COMPANY", suspendedCompanies: "SKIPPED" }), { dryRun: true, companyIds: [COMPANY_A] })).toBeNull();
  });
});

describe("graceful shutdown (§57, §58, §196)", () => {
  it("stops claiming, releases the job in hand, marks the process stopped", async () => {
    const slow = testJob();
    const next = testJob();
    let nextRuns = 0;
    let started!: () => void;
    const slowStarted = new Promise<void>((resolve) => (started = resolve));
    const controller = new AbortController();
    const id = worker("stopping");

    const running = runWorker({
      workerId: id,
      groups: ["scheduled"],
      signal: controller.signal,
      jobs: [slow, next],
      tickMs: 50,
      beatMs: 100,
      handlers: {
        [slow.key]: async (context) => {
          started();
          return untilAborted(context);
        },
        [next.key]: async () => {
          nextRuns += 1;
          return { processed: 0 };
        },
      },
    });

    await slowStarted;
    expect((await liveWorkers()).some((live) => live.workerId === id)).toBe(true);
    controller.abort();
    await running;

    expect(nextRuns).toBe(0);
    const row = await heartbeat(slow);
    expect(row.leaseOwner).toBeNull();
    expect(row.failures).toBe(0);
    expect(await secondsFromNow(row.nextRunAt)).toBeLessThanOrEqual(1);
    const process = await prisma.workerProcess.findUniqueOrThrow({ where: { workerId: id } });
    expect(process.status).toBe("STOPPED");
    expect(process.stoppedAt).not.toBeNull();
  });

  it("stops a company-by-company job between companies", async () => {
    const job = testJob({ companyScope: "COMPANY", suspendedCompanies: "SKIPPED" });
    const controller = new AbortController();
    const visited: string[] = [];
    const outcome = await runJobIfDue(job, worker("a"), {
      signal: controller.signal,
      companyIds: [COMPANY_A, COMPANY_B],
      handlers: {
        [job.key]: async () => {
          await forEachCompany(job.key, async (system) => {
            visited.push(system.companyId);
            controller.abort();
          });
          return { processed: visited.length };
        },
      },
    });
    expect(visited).toHaveLength(1);
    expect(outcome.status).toBe("skipped");
    expect((await heartbeat(job)).leaseOwner).toBeNull();
  });
});

describe("deployment overlap (§59, §60, §197)", () => {
  it("runs a job once when an old and a new worker reach it together", async () => {
    const job = testJob();
    let runs = 0;
    const handlers = {
      [job.key]: async () => {
        runs += 1;
        await sleep(200);
        return { processed: 1 };
      },
    };
    const signal = new AbortController().signal;
    const [old, fresh] = await Promise.all([
      runWorker({ workerId: worker("v1"), version: "1.0.0", groups: ["scheduled"], signal, jobs: [job], handlers, once: true }),
      runWorker({ workerId: worker("v2"), version: "1.1.0", groups: ["scheduled"], signal, jobs: [job], handlers, once: true }),
    ]);
    expect(runs).toBe(1);
    expect([...old, ...fresh].map((outcome) => outcome.status).sort()).toEqual(["skipped", "success"]);
    const versions = await prisma.workerProcess.findMany({ where: { workerId: { startsWith: PREFIX } }, select: { version: true } });
    expect(versions.map((row) => row.version).sort()).toEqual(["1.0.0", "1.1.0"]);
  });
});

describe("worker process heartbeat (§25, §116-§118)", () => {
  it("counts a beating process as live, and a stopped or silent one as gone", async () => {
    const live = worker("live");
    const stopped = worker("stopped");
    const silent = worker("silent");
    for (const id of [live, stopped, silent]) await registerWorkerProcess({ workerId: id, groups: ["notifications"], version: "test" });
    await markWorkerProcess(stopped, "STOPPED");
    await prisma.workerProcess.update({ where: { workerId: silent }, data: { lastHeartbeatAt: new Date(Date.now() - 5 * 60_000) } });

    const ids = (await liveWorkers()).map((row) => row.workerId);
    expect(ids).toContain(live);
    expect(ids).not.toContain(stopped);
    expect(ids).not.toContain(silent);
  });
});
