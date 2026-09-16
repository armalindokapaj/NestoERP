import { logger, serialiseError } from "@/lib/core/observability/logger";
import { currentRequestContext, newCorrelationId, newRequestId, runWithRequestContext } from "@/lib/core/observability/request-context";
import { prisma } from "@/lib/database/prisma";
import { currentJobRun } from "./job.context";
import { JobError } from "./job.errors";

/**
 * The actor behind background work (PRD #47 §92-§94, §240, §241).
 *
 * A job is not a person and never borrows one's `UserContext`: it acts inside
 * exactly one company at a time, under its own name, and everything it writes
 * or logs carries that company. Recipients it notifies are re-authorised in
 * their own context when they open what they were told about (§242).
 */
export type SystemContext = {
  actorType: "SYSTEM";
  companyId: string;
  jobName: string;
  correlationId: string;
};

export type CompanyRunReport<T> = {
  results: { companyId: string; result: T }[];
  /** Companies whose run threw; the others still ran (§241). */
  failed: { companyId: string; error: string }[];
};

/**
 * Runs one job body per active company, in a stable order, one company at a
 * time.
 *
 * Each company is isolated from the others' failures: a bad settings row in
 * one tenant is logged with its company id and reported, and the companies
 * after it still get their reminders. Without this a company that always
 * failed early in the list would silently stop the job for everybody behind
 * it, run after run.
 *
 * Inside a runner's job run (PRD #51 §12-§14, §57, §164) it also:
 * - keeps to the companies an operator named with `--company`;
 * - stops between companies once the run is told to stop — shutdown, timeout
 *   or a lost lease — and throws, so a partial pass is never recorded as a
 *   success;
 * - gives every company the run's correlation id, so its logs, audit and
 *   outbox rows are found together.
 */
export async function forEachCompany<T>(
  jobName: string,
  run: (context: SystemContext) => Promise<T>,
  options: {
    companyIds?: readonly string[];
    /** Only companies with this module switched on (§26: a disabled module's jobs do not run). */
    moduleKey?: string;
    /** Housekeeping that must also reach suspended companies' rows. */
    includeInactive?: boolean;
  } = {},
): Promise<CompanyRunReport<T>> {
  const jobRun = currentJobRun();
  const scoped = [options.companyIds, jobRun?.companyIds ?? undefined].filter((ids): ids is readonly string[] => Boolean(ids));
  const companyIds = scoped.length === 0 ? undefined : scoped.reduce((left, right) => left.filter((id) => right.includes(id)));

  const companies = await prisma.company.findMany({
    where: {
      ...(options.includeInactive ? {} : { status: "ACTIVE" as const }),
      ...(companyIds ? { id: { in: [...companyIds] } } : {}),
      ...(options.moduleKey ? { modules: { some: { enabled: true, module: { key: options.moduleKey } } } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const parent = currentRequestContext();
  const correlationId = jobRun?.correlationId ?? parent?.correlationId ?? newCorrelationId();
  const report: CompanyRunReport<T> = { results: [], failed: [] };
  for (const company of companies) {
    if (jobRun?.signal.aborted) {
      throw jobRun.signal.reason instanceof Error ? jobRun.signal.reason : new JobError("ABORTED", `${jobName} stopped before company ${company.id}`);
    }
    const context: SystemContext = { actorType: "SYSTEM", companyId: company.id, jobName, correlationId };
    const requestContext = {
      requestId: jobRun?.runId ?? parent?.requestId ?? newRequestId(),
      correlationId,
      startedAt: Date.now(),
      route: `job:${jobName}`,
      companyId: company.id,
      jobKey: jobName,
      workerId: jobRun?.workerId,
    };
    try {
      report.results.push({ companyId: company.id, result: await runWithRequestContext(requestContext, () => run(context)) });
    } catch (error) {
      logger.error("worker.job.company_failed", { job: jobName, companyId: company.id, correlationId, ...serialiseError(error) });
      report.failed.push({ companyId: company.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

/**
 * Ends a job whose companies did not all succeed — after every company has
 * had its turn, so the failure is reported to the runner and to health
 * without costing the other companies their run.
 */
export function assertEveryCompanySucceeded(jobName: string, report: CompanyRunReport<unknown>): void {
  if (report.failed.length === 0) return;
  throw new JobError("PARTIAL_FAILURE", `${jobName} failed for ${report.failed.length} of ${report.failed.length + report.results.length} companies`);
}
