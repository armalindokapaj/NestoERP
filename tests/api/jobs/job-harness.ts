import { JOB_HANDLERS } from "@/lib/core/jobs/job.handlers";
import { runWithinJob } from "@/lib/core/jobs/job.context";
import { findJob, type JobContext, type JobResult } from "@/lib/core/jobs/job.registry";
import { newCorrelationId, newRequestId, runWithRequestContext } from "@/lib/core/observability/request-context";
import { prisma } from "../../helpers";

/**
 * The job contract harness (PRD #51 §173-§195).
 *
 * Every registered job has `tests/api/jobs/<job key>.test.ts`, shaped so the
 * CI gate in `tests/architecture/workers.test.ts` can read it:
 *
 *   describe("<job key>", () => {
 *     describe("idempotency", …)        every job: run twice, one effect
 *     describe("failure", …)            every job: what a failing unit does to the rest, and to the run
 *     describe("company isolation", …)  COMPANY and RECORD jobs: company A's run never touches B
 *     describe("suspended company", …)  COMPANY and RECORD jobs: skipped, or deliberately included
 *     describe("concurrency", …)        CRITICAL, HIGH and OUTBOX jobs: two at once, one effect
 *   })
 *
 * `invokeJob` calls the registered handler exactly as the runner does — inside
 * a job run, so `forEachCompany`, the signal, `--company` and `--dry-run` all
 * behave as in production — but without the lease: the lease is the runner's
 * contract and has its own tests, and a test holding a real job's lease would
 * stop another test file running that job.
 */

/** The seeded tenants (prisma/seed/constants.ts). */
export const COMPANY_A = "company_demo_a";
export const COMPANY_B = "company_demo_b";
/** Seeded SUSPENDED, with one member. */
export const COMPANY_SUSPENDED = "company_demo_suspended";

export type InvokeOptions = {
  now?: Date;
  lastSuccessAt?: Date | null;
  dryRun?: boolean;
  companyIds?: readonly string[] | null;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
};

export async function invokeJob(key: string, options: InvokeOptions = {}): Promise<JobResult> {
  const job = findJob(key);
  const handler = JOB_HANDLERS[key];
  if (!job || !handler) throw new Error(`No registered job ${key}`);

  const correlationId = newCorrelationId();
  const runId = newRequestId();
  const workerId = `test-worker:${process.pid}`;
  const signal = options.signal ?? new AbortController().signal;
  const dryRun = Boolean(options.dryRun && job.dryRun);
  const context: JobContext = {
    now: options.now ?? new Date(),
    lastSuccessAt: options.lastSuccessAt ?? null,
    env: options.env ?? process.env,
    signal,
    dryRun,
    companyIds: options.companyIds ?? null,
    correlationId,
    workerId,
  };
  return runWithRequestContext({ requestId: runId, correlationId, startedAt: Date.now(), route: `job:${key}`, jobKey: key, workerId }, () =>
    runWithinJob({ jobKey: key, runId, correlationId, workerId, signal, companyIds: context.companyIds, dryRun }, () => handler(context)),
  );
}

/** Runs `fn` with a company's status changed, and puts it back whatever happens. */
export async function withCompanyStatus<T>(companyId: string, status: "ACTIVE" | "SUSPENDED" | "INACTIVE", fn: () => Promise<T>): Promise<T> {
  const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { status: true } });
  await prisma.company.update({ where: { id: companyId }, data: { status } });
  try {
    return await fn();
  } finally {
    await prisma.company.update({ where: { id: companyId }, data: { status: before.status } });
  }
}

/** Runs `fn` with a module switched on or off for a company, and puts it back. */
export async function withModule<T>(companyId: string, moduleKey: string, enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const row = await prisma.companyModule.findFirst({ where: { companyId, module: { key: moduleKey } }, select: { id: true, enabled: true } });
  if (!row) throw new Error(`${companyId} has no ${moduleKey} module row`);
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled } });
  try {
    return await fn();
  } finally {
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: row.enabled } });
  }
}

/** Idempotency ledger rows a test created, for cleanup. */
export async function clearIdempotencyKeys(jobKey: string, keyPrefixes: string[]): Promise<void> {
  if (keyPrefixes.length === 0) return;
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey, OR: keyPrefixes.map((prefix) => ({ key: { startsWith: prefix } })) } });
}
