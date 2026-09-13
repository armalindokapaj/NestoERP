import { z } from "zod";

/**
 * Environment validation (PRD #34 §54-§55, PRD #30 §349).
 *
 * A production process that is missing a secret must fail immediately and
 * loudly, not start and fail later on the first request that needed it
 * (PRD #34 §55, PRD #32 §329, §330).
 *
 * APP_ENV is server-authoritative: security behaviour is never inferred from a
 * value the client can see (PRD #34 §11, PRD #30 §349).
 */

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["development", "staging", "production"]).optional(),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    AUTH_SECRET: z.string().optional(),
    NEXTAUTH_SECRET: z.string().optional(),

    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_RELEASE_VERSION: z.string().optional(),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).optional(),

    STORAGE_DRIVER: z.enum(["local", "s3"]).optional(),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_SCANNER: z.enum(["none", "eicar", "clamav"]).optional(),
    STORAGE_SCANNER_REQUIRED: z.enum(["true", "false"]).optional(),
    REDIS_URL: z.string().optional(),
    MAINTENANCE_MODE: z.enum(["true", "false"]).optional(),

    // Mail (PRD #38 §10, §12, §171)
    MAIL_PROVIDER: z.enum(["memory", "console", "resend", "postmark"]).optional(),
    MAIL_FROM: z.string().optional(),
    MAIL_API_KEY: z.string().optional(),
    MAIL_ALLOWED_RECIPIENTS: z.string().optional(),
    APP_URL: z.string().url().optional(),

    // Metrics scraping (PRD #38 §105)
    METRICS_TOKEN: z.string().min(24, "METRICS_TOKEN must be at least 24 characters").optional(),
  })
  .superRefine((value, ctx) => {
    const appEnv = value.APP_ENV ?? value.NODE_ENV;
    if (appEnv !== "production") return;

    // Production-only requirements (PRD #34 §225, PRD #30 §408).
    if (!value.AUTH_SECRET && !value.NEXTAUTH_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AUTH_SECRET is required in production" });
    }
    if (!value.NEXT_PUBLIC_APP_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "NEXT_PUBLIC_APP_URL is required in production" });
    }
    if (value.STORAGE_DRIVER === "local") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local filesystem storage is not permitted in production",
      });
    }
  })
  .superRefine((value, ctx) => {
    // Only an explicit APP_ENV makes these strict: a local production build
    // (`pnpm test:e2e:prod`) sets NODE_ENV alone and runs on the memory sink.
    const deployed = value.APP_ENV === "production" || value.APP_ENV === "staging";
    if (!deployed) return;

    const realProvider = value.MAIL_PROVIDER === "resend" || value.MAIL_PROVIDER === "postmark";
    if (value.APP_ENV === "production" && !realProvider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MAIL_PROVIDER must be a real transactional provider in production",
      });
    }
    if (realProvider && (!value.MAIL_FROM || !value.MAIL_API_KEY)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MAIL_FROM and MAIL_API_KEY are required" });
    }
    // Staging never mails a real customer (PRD #38 §12).
    if (value.APP_ENV === "staging" && realProvider && !value.MAIL_ALLOWED_RECIPIENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MAIL_ALLOWED_RECIPIENTS is required for a real mail provider in staging",
      });
    }
    // A deployed environment scans what it stores (PRD #38 §99, §100).
    if (value.STORAGE_SCANNER_REQUIRED !== "false" && (!value.STORAGE_SCANNER || value.STORAGE_SCANNER === "none")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STORAGE_SCANNER must name a scanner in staging and production",
      });
    }
  });

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | null = null;

export function readEnv(): AppEnv {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    // Never echo the values themselves — only which variable is wrong.
    throw new Error(`Invalid environment configuration: ${detail}`);
  }

  cached = parsed.data;
  return cached;
}

export function appEnvironment(): "development" | "staging" | "production" {
  const env = readEnv();
  return env.APP_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
}

export function isProduction(): boolean {
  return appEnvironment() === "production";
}

/** Development conveniences must be impossible in production (PRD #30 §261, PRD #34 §52). */
export function devFeaturesEnabled(): boolean {
  return appEnvironment() === "development";
}
