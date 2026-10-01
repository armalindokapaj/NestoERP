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
    APP_ENV: z.enum(["development", "test", "demo", "staging", "production"]).optional(),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    AUTH_SECRET: z.string().optional(),
    NEXTAUTH_SECRET: z.string().optional(),

    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_RELEASE_VERSION: z.string().optional(),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).optional(),

    STORAGE_DRIVER: z.enum(["local", "s3", "supabase"]).optional(),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_SCANNER: z.enum(["none", "eicar", "clamav"]).optional(),
    STORAGE_SCANNER_REQUIRED: z.enum(["true", "false"]).optional(),
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).optional(),
    REDIS_URL: z.string().optional(),
    MAINTENANCE_MODE: z.enum(["true", "false"]).optional(),

    // Mail (PRD #38 §10, §12, §171). V0.1 delivers in-app and needs no email
    // at all: `MAIL_DELIVERY=disabled` says so explicitly, and then nothing
    // about mail is required, and nothing is sent (PRD #51 §62, §63, §212, §215).
    MAIL_DELIVERY: z.enum(["enabled", "disabled"]).optional(),
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
    // A hosted demo is hosted: it needs real secrets like production.
    if (appEnv !== "production" && appEnv !== "demo") return;

    // Production-only requirements (PRD #34 §225, PRD #30 §408).
    if (!value.AUTH_SECRET && !value.NEXTAUTH_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AUTH_SECRET is required in production" });
    } else if ((value.AUTH_SECRET ?? value.NEXTAUTH_SECRET ?? "").length < 32) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)" });
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
    // An explicit decision not to send mail is not a mail sink left by accident.
    const mailDisabled = value.MAIL_DELIVERY === "disabled";

    const realProvider = value.MAIL_PROVIDER === "resend" || value.MAIL_PROVIDER === "postmark";
    if (value.APP_ENV === "production" && !realProvider && !mailDisabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MAIL_PROVIDER must be a real transactional provider in production",
      });
    }
    if (realProvider && !mailDisabled && (!value.MAIL_FROM || !value.MAIL_API_KEY)) {
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
    // The EICAR scanner recognises one test string; it is not an engine.
    if (value.APP_ENV === "production" && value.STORAGE_SCANNER === "eicar") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "STORAGE_SCANNER=eicar is a test scanner and cannot run in production" });
    }
    if (value.STORAGE_SCANNER === "clamav" && !value.CLAMAV_HOST) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "STORAGE_SCANNER=clamav needs CLAMAV_HOST" });
    }
  });

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | null = null;

/** What is wrong with an environment, by variable and rule — never the values themselves. */
export function environmentProblems(env: NodeJS.ProcessEnv): string[] {
  const parsed = schema.safeParse(env);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

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

/**
 * The deployment class for safety rules. A hosted demo (`APP_ENV=demo`) is a
 * hosted deployment: it gets production's protections (HTTPS storage,
 * confirmation before deletion) while its demo conveniences are decided by
 * `lib/auth/dev-mode.ts`. `test` is a developer's machine.
 */
export function appEnvironment(): "development" | "staging" | "production" {
  const env = readEnv();
  if (env.APP_ENV === "demo") return "production";
  if (env.APP_ENV === "test") return "development";
  return env.APP_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
}

export function isProduction(): boolean {
  return appEnvironment() === "production";
}

/**
 * Whether this deployment sends email at all (PRD #51 §62, §63, §215). Read
 * directly, like the mail service's own environment, so a local production
 * build keeps its memory sink.
 */
export function mailDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MAIL_DELIVERY !== "disabled";
}

/** Development conveniences must be impossible in production (PRD #30 §261, PRD #34 §52). */
export function devFeaturesEnabled(): boolean {
  return appEnvironment() === "development";
}
