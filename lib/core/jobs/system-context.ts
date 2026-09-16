import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";

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
  const companies = await prisma.company.findMany({
    where: {
      ...(options.includeInactive ? {} : { status: "ACTIVE" as const }),
      ...(options.companyIds ? { id: { in: [...options.companyIds] } } : {}),
      ...(options.moduleKey ? { modules: { some: { enabled: true, module: { key: options.moduleKey } } } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const report: CompanyRunReport<T> = { results: [], failed: [] };
  for (const company of companies) {
    const context: SystemContext = { actorType: "SYSTEM", companyId: company.id, jobName, correlationId: crypto.randomUUID() };
    try {
      report.results.push({ companyId: company.id, result: await run(context) });
    } catch (error) {
      logger.error("worker.job.company_failed", { job: jobName, companyId: company.id, correlationId: context.correlationId, ...serialiseError(error) });
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
  throw new Error(`${jobName} failed for ${report.failed.length} of ${report.failed.length + report.results.length} companies`);
}
