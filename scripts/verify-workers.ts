/**
 * Worker gates (PRD #51 §106-§108, §198-§202, §216, §231).
 *
 *   1. The registry is valid: unique keys, a handler for every job and a job for
 *      every handler, schedules, timeouts and retry policies that make sense.
 *   2. Every owner is a real domain directory.
 *   3. Every job has its contract tests, with the properties its shape demands.
 *   4. Handlers call their owners and write nothing themselves.
 *   5. Nothing under app/ can start a job.
 *   6. Every alert reads a metric the exporter still writes.
 *   7. docs/worker-matrix.md matches the registry.
 *
 * `--write` regenerates docs/worker-matrix.md.
 */
import { writeFileSync } from "node:fs";

import { JOB_HANDLERS } from "../lib/core/jobs/job.handlers";
import { JOBS, validateRegistry } from "../lib/core/jobs/job.registry";
import {
  alertRuleProblems,
  contractTestProblems,
  handlerProblems,
  MATRIX_PATH,
  matrixProblems,
  ownerProblems,
  renderWorkerMatrix,
  triggerRouteProblems,
} from "./architecture/workers";

if (process.argv.includes("--write")) {
  writeFileSync(MATRIX_PATH, renderWorkerMatrix());
  console.log(`✓ wrote ${MATRIX_PATH}`);
}

const sections: Array<[string, string[]]> = [
  ["registry", validateRegistry(JOBS, JOB_HANDLERS)],
  ["owners", ownerProblems()],
  ["contract tests", contractTestProblems()],
  ["handlers", handlerProblems()],
  ["trigger routes", triggerRouteProblems()],
  ["alert rules", alertRuleProblems()],
  ["worker matrix", matrixProblems()],
];

let failed = false;
for (const [name, problems] of sections) {
  if (problems.length === 0) {
    console.log(`✓ ${name}`);
    continue;
  }
  failed = true;
  console.error(`✗ ${name}`);
  for (const problem of problems) console.error(`    ${problem}`);
}

console.log(`\n${JOBS.length} jobs registered.`);
process.exit(failed ? 1 : 0);
