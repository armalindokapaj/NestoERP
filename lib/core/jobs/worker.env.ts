import { environmentProblems } from "@/lib/config/env";

/**
 * What a worker checks about its configuration before it claims anything
 * (PRD #51 §53, §54, §211, §212).
 *
 * The web tier's schema first — the worker runs from the same artifact with
 * the same environment — then the settings only a worker reads. A typo in one
 * of those would otherwise be a silent fallback: a retention run that never
 * applies, a batch size quietly back at its default.
 */

export const DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30;

const INTEGER_SETTINGS: Array<{ name: string; min: number; max: number }> = [
  { name: "NOTIFICATION_BATCH_SIZE", min: 1, max: 1000 },
  { name: "SCAN_BATCH_SIZE", min: 1, max: 1000 },
  { name: "WORKER_SHUTDOWN_TIMEOUT_SECONDS", min: 5, max: 600 },
];

const BOOLEAN_SETTINGS = ["WORKER_RETENTION_APPLY"];

export function workerEnvironmentProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems = environmentProblems(env);
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required");

  for (const setting of INTEGER_SETTINGS) {
    const raw = env[setting.name];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < setting.min || value > setting.max) {
      problems.push(`${setting.name} must be a whole number from ${setting.min} to ${setting.max}`);
    }
  }
  for (const name of BOOLEAN_SETTINGS) {
    const raw = env[name];
    if (raw !== undefined && raw !== "" && raw !== "true" && raw !== "false") problems.push(`${name} must be true or false`);
  }
  return problems;
}

export function shutdownTimeoutSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.WORKER_SHUTDOWN_TIMEOUT_SECONDS);
  return Number.isInteger(value) && value >= 5 && value <= 600 ? value : DEFAULT_SHUTDOWN_TIMEOUT_SECONDS;
}
