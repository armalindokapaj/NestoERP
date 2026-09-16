import { describe, expect, it } from "vitest";

import { JOB_HANDLERS } from "@/lib/core/jobs/job.handlers";
import { JOBS, jobUnavailableReason, validateRegistry, type JobDefinition } from "@/lib/core/jobs/job.registry";
import {
  alertRuleProblems,
  contractTestProblems,
  handlerProblems,
  matrixProblems,
  ownerProblems,
  triggerRouteProblems,
} from "../../scripts/architecture/workers";

/**
 * The worker gates (PRD #51 §106-§108, §198-§202, §216, §231). The same checks
 * `pnpm verify:workers` prints, held here so `pnpm test:architecture` blocks a
 * regression.
 */

const noop = async () => ({ processed: 0 });

function job(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return { ...JOBS.find((candidate) => candidate.key === "planning.milestones")!, ...overrides };
}

describe("the worker registry", () => {
  it("is valid against the real handlers", () => {
    expect(validateRegistry(JOBS, JOB_HANDLERS)).toEqual([]);
  });

  it("names an owner that is a real domain directory for every job", () => {
    expect(ownerProblems()).toEqual([]);
  });

  it("refuses a duplicate job key (§107)", () => {
    const problems = validateRegistry([job(), job()], { "planning.milestones": noop });
    expect(problems).toContain("job planning.milestones: duplicate job key");
  });

  it("refuses a job without a handler, and a handler without a job (§108)", () => {
    const problems = validateRegistry([job()], { "planning.orphan": noop });
    expect(problems).toContain("job planning.milestones: no handler");
    expect(problems).toContain("handler planning.orphan: no job registered for it");
  });

  it("refuses an invalid schedule, timeout or retry policy (§198)", () => {
    const handlers = { "planning.milestones": noop };
    expect(validateRegistry([job({ intervalSeconds: 1 })], handlers)).toContain("job planning.milestones: interval must be at least 10 seconds");
    expect(validateRegistry([job({ staleAfterSeconds: 10 })], handlers)).toContain("job planning.milestones: staleAfter must exceed the interval");
    expect(validateRegistry([job({ timeoutSeconds: 0 })], handlers)).toContain("job planning.milestones: no timeout");
    expect(validateRegistry([job({ retry: undefined as never })], handlers)).toContain("job planning.milestones: no retry policy");
    expect(validateRegistry([job({ retry: { maxAttempts: 0, initialDelaySeconds: 10, maxDelaySeconds: 5 } })], handlers)).toEqual(
      expect.arrayContaining(["job planning.milestones: maxAttempts must be 1-20", "job planning.milestones: retry maxDelay must be at least the initial delay"]),
    );
  });

  it("refuses a PLATFORM job that claims to skip suspended companies", () => {
    const problems = validateRegistry([job({ companyScope: "PLATFORM", suspendedCompanies: "SKIPPED" })], { "planning.milestones": noop });
    expect(problems).toContain("job planning.milestones: a PLATFORM job has no companies to skip");
  });

  it("refuses to disable a job that does not exist, and honours one that does (§109)", () => {
    const env = { WORKER_DISABLED_JOBS: "planning.milestones,planning.nope" } as unknown as NodeJS.ProcessEnv;
    expect(validateRegistry([job()], { "planning.milestones": noop }, env)).toContain("WORKER_DISABLED_JOBS names an unknown job: planning.nope");
    expect(jobUnavailableReason(job(), { env })).toBe("disabled by WORKER_DISABLED_JOBS");
  });

  it("does not run a job whose capability is missing (§214)", () => {
    const scan = JOBS.find((candidate) => candidate.key === "documents.scan")!;
    expect(jobUnavailableReason(scan, { env: {} as NodeJS.ProcessEnv, capabilities: { scanner: false } })).toBe("no malware scanner configured");
    expect(jobUnavailableReason(scan, { env: {} as NodeJS.ProcessEnv, capabilities: { scanner: true } })).toBeNull();
  });

  it("gives every CRITICAL and HIGH job a retry policy that retries within minutes", () => {
    for (const candidate of JOBS.filter((entry) => entry.criticality === "CRITICAL" || entry.criticality === "HIGH")) {
      expect(candidate.retry.initialDelaySeconds, candidate.key).toBeLessThanOrEqual(60);
    }
  });
});

describe("the worker contract tests (§173, §201, §202)", () => {
  it("exist for every job, with each property its shape demands", () => {
    expect(contractTestProblems()).toEqual([]);
  });
});

describe("worker boundaries (§3, §199, §216)", () => {
  it("keeps handlers to calls into owning services", () => {
    expect(handlerProblems()).toEqual([]);
  });

  it("lets nothing under app/ start a job", () => {
    expect(triggerRouteProblems()).toEqual([]);
  });
});

describe("worker observability (§124, §231)", () => {
  it("alerts only on metrics the exporter writes", () => {
    expect(alertRuleProblems()).toEqual([]);
  });

  it("keeps docs/worker-matrix.md in step with the registry", () => {
    expect(matrixProblems()).toEqual([]);
  });
});
