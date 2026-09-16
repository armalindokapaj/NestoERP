import { existsSync, readFileSync } from "node:fs";

import ts from "typescript";

import { JOBS, type JobDefinition } from "../../lib/core/jobs/job.registry";
import { parse, walk } from "../security/source";
import { writeSites } from "./writes";

/**
 * The worker gates (PRD #51 §106-§108, §198-§202, §216, §231, §287).
 *
 * Pure functions over the registry and the source tree, shared by
 * `scripts/verify-workers.ts` and `tests/architecture/workers.test.ts`.
 */

export const MATRIX_PATH = "docs/worker-matrix.md";
export const ALERTS_PATH = "ops/alerts/workers.yml";

/* -------------------------------------------------------------------------- */
/* Contract tests                                                              */
/* -------------------------------------------------------------------------- */

/** What a job's contract file must prove, by the job's declared shape (§173, §201, §202). */
export function requiredContracts(job: JobDefinition): string[] {
  const required = ["idempotency", "failure"];
  if (job.companyScope !== "PLATFORM") required.push("company isolation", "suspended company");
  if (job.criticality === "CRITICAL" || job.criticality === "HIGH" || job.trigger === "OUTBOX") required.push("concurrency");
  return required;
}

export function contractPath(job: JobDefinition): string {
  return `tests/api/jobs/${job.key}.test.ts`;
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  // describe.each / it.concurrent and the like
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) return callee.expression.text;
  return null;
}

function firstStringArgument(call: ts.CallExpression): string | null {
  const first = call.arguments[0];
  return first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : null;
}

/** The describe blocks nested directly or deeply under `describe(<jobKey>)`, each with its count of tests. */
function describedContracts(file: string, jobKey: string): Map<string, number> | null {
  const source = parse(file);
  let found: Map<string, number> | null = null;

  const countTests = (node: ts.Node): number => {
    let count = 0;
    const visit = (current: ts.Node) => {
      if (ts.isCallExpression(current) && ["it", "test"].includes(calleeName(current) ?? "")) count += 1;
      ts.forEachChild(current, visit);
    };
    visit(node);
    return count;
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && calleeName(node) === "describe" && firstStringArgument(node) === jobKey) {
      found = new Map();
      const body = node.arguments[1];
      if (body) {
        const inner = (current: ts.Node) => {
          if (ts.isCallExpression(current) && calleeName(current) === "describe") {
            const name = firstStringArgument(current);
            if (name) found!.set(name, (found!.get(name) ?? 0) + countTests(current));
          }
          ts.forEachChild(current, inner);
        };
        ts.forEachChild(body, inner);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function contractTestProblems(jobs: readonly JobDefinition[] = JOBS): string[] {
  const problems: string[] = [];
  for (const job of jobs) {
    const file = contractPath(job);
    if (!existsSync(file)) {
      problems.push(`${job.key}: no contract tests — expected ${file}`);
      continue;
    }
    const described = describedContracts(file, job.key);
    if (!described) {
      problems.push(`${file}: no top-level describe("${job.key}")`);
      continue;
    }
    for (const contract of requiredContracts(job)) {
      const tests = described.get(contract) ?? 0;
      if (tests === 0) problems.push(`${job.key}: no "${contract}" test in ${file}`);
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Handlers call owners; nothing on the web triggers a job                     */
/* -------------------------------------------------------------------------- */

/**
 * A handler is a call into the owning domain (§3, §131, §199): the handlers
 * file and the worker command write nothing and query nothing themselves.
 */
export function handlerProblems(): string[] {
  const problems: string[] = [];
  const files = ["lib/core/jobs/job.handlers.ts", "scripts/worker.ts"];
  for (const site of writeSites(files)) {
    problems.push(`${site.file}:${site.line}: ${site.model}.${site.op} — a job's writes belong in its owner's service`);
  }
  const handlers = readFileSync("lib/core/jobs/job.handlers.ts", "utf8");
  if (/\bprisma\b/.test(handlers)) problems.push("lib/core/jobs/job.handlers.ts: uses prisma — a handler calls its owner's service and nothing else");
  return problems;
}

const RUNNER_MODULES = /["']@\/lib\/core\/jobs\/(job\.runner|job\.handlers|job\.manual|worker\.loop)["']/;

/** No public endpoint may trigger a job (§216-§218): nothing under app/ imports the runner. */
export function triggerRouteProblems(): string[] {
  const accept = (file: string) => file.endsWith(".ts") || file.endsWith(".tsx");
  return walk("app", accept)
    .filter((file) => RUNNER_MODULES.test(readFileSync(file, "utf8")))
    .map((file) => `${file}: imports the job runner — jobs are started by the worker process, never by a request`);
}

/* -------------------------------------------------------------------------- */
/* Owners, alerts                                                              */
/* -------------------------------------------------------------------------- */

export function ownerProblems(jobs: readonly JobDefinition[] = JOBS): string[] {
  return jobs
    .filter((job) => !existsSync(job.owner.startsWith("core/") ? `lib/${job.owner}` : `lib/modules/${job.owner}`))
    .map((job) => `${job.key}: owner "${job.owner}" is not a domain directory`);
}

const EXPORTERS = ["lib/core/jobs/job.metrics.ts", "lib/core/observability/operational-gauges.ts"];

/** Every metric an alert reads is one the exporter still writes (§124, §283). */
export function alertRuleProblems(): string[] {
  if (!existsSync(ALERTS_PATH)) return [`${ALERTS_PATH} is missing`];
  const exported = new Set(EXPORTERS.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/name: "([a-z_]+)"/g)].map((match) => match[1])));
  const rules = readFileSync(ALERTS_PATH, "utf8");
  const problems: string[] = [];
  for (const [, expr] of rules.matchAll(/expr:\s*(.+)/g)) {
    for (const [metric] of expr.matchAll(/\b(worker|notification|scan)_[a-z_]+/g)) {
      if (!exported.has(metric)) problems.push(`${ALERTS_PATH}: alert reads ${metric}, which no exporter writes`);
    }
  }
  for (const job of JOBS.filter((candidate) => candidate.criticality === "CRITICAL")) {
    if (!/worker_job_failed\{criticality=~"CRITICAL/.test(rules)) problems.push(`${ALERTS_PATH}: no failure alert covers CRITICAL jobs such as ${job.key}`);
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* docs/worker-matrix.md                                                       */
/* -------------------------------------------------------------------------- */

function duration(seconds: number): string {
  if (seconds === 0) return "—";
  if (seconds % 86_400 === 0) return seconds === 86_400 ? "1 day" : `${seconds / 86_400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? "1 h" : `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

const SCOPE: Record<JobDefinition["companyScope"], string> = {
  COMPANY: "per company",
  RECORD: "per work item's company",
  PLATFORM: "platform (no company data)",
};

const SUSPENDED: Record<JobDefinition["suspendedCompanies"], string> = {
  SKIPPED: "suspended skipped",
  INCLUDED: "suspended included",
  NOT_APPLICABLE: "",
};

/** The alert rules that watch a job, by its criticality and what it feeds (ops/alerts/workers.yml). */
export function alertsFor(job: JobDefinition): string {
  const alerts =
    job.criticality === "CRITICAL" || job.criticality === "HIGH"
      ? ["WorkerCriticalJobFailed", "WorkerCriticalJobStale"]
      : job.trigger === "MANUAL"
        ? ["WorkerJobFailed"]
        : ["WorkerJobFailed", "WorkerJobStale"];
  if (job.key === "notifications.dispatch") alerts.push("NotificationOutboxBacklog", "NotificationOutboxFailedEvents");
  if (job.key === "documents.scan") alerts.push("ScanQueueStuck", "ScanFilesFailed", "ScanClaimsAbandoned", "ScanQuarantineOwed");
  const severity = job.criticality === "CRITICAL" || job.criticality === "HIGH" ? "page" : "ticket";
  return `${alerts.map((alert) => `\`${alert}\``).join(", ")} (${severity})`;
}

export function renderWorkerMatrix(jobs: readonly JobDefinition[] = JOBS): string {
  const lines: string[] = [];
  lines.push("# Worker matrix");
  lines.push("");
  lines.push("Every background job NESTO runs (PRD #51 §231, §287). Generated from");
  lines.push("`lib/core/jobs/job.registry.ts` by `pnpm verify:workers --write`; CI fails when");
  lines.push("this file and the registry disagree, so edit the registry, not this page.");
  lines.push("");
  lines.push("How the columns are enforced, and what to do when a job misbehaves: `docs/workers.md`");
  lines.push("and `docs/worker-operations.md`.");
  lines.push("");
  lines.push("| Job | Owner | Trigger | Schedule | Company scope | Idempotency key | Retry | Timeout | Criticality | Alert |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const job of jobs) {
    const schedule = job.trigger === "MANUAL" ? `manual, \`${job.group}\`` : `every ${duration(job.intervalSeconds)}, \`${job.group}\` group`;
    const scope = [SCOPE[job.companyScope], SUSPENDED[job.suspendedCompanies]].filter(Boolean).join("; ");
    const retry = `${job.retry.maxAttempts} attempts, ${duration(job.retry.initialDelaySeconds)} doubling to ${duration(job.retry.maxDelaySeconds)}`;
    const timeout = `${duration(job.timeoutSeconds)} (lease ${duration(job.leaseSeconds)}, extended while running)`;
    lines.push(
      `| \`${job.key}\` | ${job.owner} | ${job.trigger} | ${schedule} | ${scope} | ${job.idempotencyKey} | ${retry} | ${timeout} | ${job.criticality} | ${alertsFor(job)} |`,
    );
  }
  lines.push("");
  lines.push("## Each job");
  lines.push("");
  for (const job of jobs) {
    lines.push(`### \`${job.key}\``);
    lines.push("");
    lines.push(job.purpose);
    lines.push("");
    lines.push(`- **Missed runs:** ${job.catchUp}`);
    lines.push(`- **Stale after:** ${job.trigger === "MANUAL" ? "not applicable (manual)" : duration(job.staleAfterSeconds)} without a success.`);
    lines.push(`- **Dry run:** ${job.dryRun ? "supported — `pnpm worker --run=" + job.key + " --dry-run`" : "not supported"}.`);
    lines.push(`- **Manual run:** \`pnpm worker --run=${job.key}\`${job.companyScope === "COMPANY" ? ` (add \`--company=<id>\` for one company)` : ""}.`);
    if (job.requires) lines.push(`- **Requires:** a configured ${job.requires}; without one the job is not run.`);
    lines.push(`- **Contract tests:** \`${contractPath(job)}\` — ${requiredContracts(job).join(", ")}.`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function matrixProblems(): string[] {
  const current = existsSync(MATRIX_PATH) ? readFileSync(MATRIX_PATH, "utf8") : "";
  return current === renderWorkerMatrix() ? [] : [`${MATRIX_PATH} is out of date — run pnpm verify:workers --write`];
}
