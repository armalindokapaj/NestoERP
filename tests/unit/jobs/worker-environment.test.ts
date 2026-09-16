import { describe, expect, it } from "vitest";

import { shutdownTimeoutSeconds, workerEnvironmentProblems } from "@/lib/core/jobs/worker.env";

/**
 * What a worker refuses to start on (PRD #51 §53, §54, §211, §212).
 */

const production = {
  NODE_ENV: "production",
  APP_ENV: "production",
  DATABASE_URL: "postgresql://nesto@db/nesto",
  AUTH_SECRET: "a-production-secret-for-the-test",
  NEXT_PUBLIC_APP_URL: "https://nesto.example",
  STORAGE_DRIVER: "s3",
  STORAGE_SCANNER: "clamav",
  CLAMAV_HOST: "clamav",
} as unknown as NodeJS.ProcessEnv;

const env = (overrides: Record<string, string | undefined>) => ({ ...production, ...overrides }) as NodeJS.ProcessEnv;

describe("worker environment", () => {
  it("accepts a complete production configuration", () => {
    expect(workerEnvironmentProblems(env({ MAIL_PROVIDER: "postmark", MAIL_FROM: "NESTO <no-reply@nesto.example>", MAIL_API_KEY: "key" }))).toEqual([]);
  });

  it("does not need email to start when mail delivery is switched off (§212)", () => {
    expect(workerEnvironmentProblems(env({}))).toContain("MAIL_PROVIDER must be a real transactional provider in production");
    expect(workerEnvironmentProblems(env({ MAIL_DELIVERY: "disabled" }))).toEqual([]);
  });

  it("refuses the web tier's own configuration problems", () => {
    expect(workerEnvironmentProblems(env({ MAIL_DELIVERY: "disabled", AUTH_SECRET: undefined }))).toContain("AUTH_SECRET is required in production");
  });

  it("requires a database", () => {
    expect(workerEnvironmentProblems(env({ MAIL_DELIVERY: "disabled", DATABASE_URL: undefined }))).toContain("DATABASE_URL is required");
  });

  it("refuses a worker setting outside its range rather than falling back quietly", () => {
    const problems = workerEnvironmentProblems(
      env({ MAIL_DELIVERY: "disabled", NOTIFICATION_BATCH_SIZE: "0", SCAN_BATCH_SIZE: "25.5", WORKER_SHUTDOWN_TIMEOUT_SECONDS: "3600", WORKER_RETENTION_APPLY: "yes" }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "NOTIFICATION_BATCH_SIZE must be a whole number from 1 to 1000",
        "SCAN_BATCH_SIZE must be a whole number from 1 to 1000",
        "WORKER_SHUTDOWN_TIMEOUT_SECONDS must be a whole number from 5 to 600",
        "WORKER_RETENTION_APPLY must be true or false",
      ]),
    );
  });

  it("bounds the shutdown deadline", () => {
    expect(shutdownTimeoutSeconds({} as NodeJS.ProcessEnv)).toBe(30);
    expect(shutdownTimeoutSeconds({ WORKER_SHUTDOWN_TIMEOUT_SECONDS: "90" } as unknown as NodeJS.ProcessEnv)).toBe(90);
  });
});
