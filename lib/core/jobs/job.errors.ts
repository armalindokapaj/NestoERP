import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { AccessError } from "@/lib/access/guards";

/**
 * What went wrong in a job, and whether trying again can help (PRD #51 §30-§32, §123).
 *
 * A worker that retries everything spins on a record that will never become
 * valid; a worker that retries nothing gives up on a database that blinked.
 * Every failure is reduced to one of these codes, and the code decides.
 */
export const JOB_ERROR_CODES = {
  /** The job ran past its timeout (§55, §56). */
  TIMEOUT: true,
  /** The worker is shutting down; the work goes back to the queue (§57). */
  ABORTED: true,
  /** Another worker holds the work now: this one's lease ran out (§26, §27). */
  LEASE_EXPIRED: true,
  DATABASE_UNAVAILABLE: true,
  /** A serialisation failure, deadlock or write conflict — the next attempt reads fresh state. */
  DATABASE_CONFLICT: true,
  NETWORK: true,
  STORAGE_UNAVAILABLE: true,
  /** Some companies failed and the rest ran; the failed ones get the next run (PRD #47 §241). */
  PARTIAL_FAILURE: true,
  /** A payload written by a newer build; a worker that understands it will pick it up (§224, §225). */
  UNSUPPORTED_PAYLOAD: true,
  UNKNOWN: true,
  // Permanent: the same input fails the same way however often it is tried (§32).
  VALIDATION: false,
  STATE_CONFLICT: false,
  NOT_ELIGIBLE: false,
  CONFIGURATION: false,
} as const satisfies Record<string, boolean>;

export type JobErrorCode = keyof typeof JOB_ERROR_CODES;

/** A failure a job raises on purpose, with its code decided where the cause is known. */
export class JobError extends Error {
  readonly code: JobErrorCode;
  readonly retryable: boolean;

  constructor(code: JobErrorCode, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "JobError";
    this.code = code;
    this.retryable = options.retryable ?? JOB_ERROR_CODES[code];
  }
}

export type ClassifiedError = { code: JobErrorCode; retryable: boolean; message: string };

/** Prisma codes that mean the database, not the data, is the problem. */
const PRISMA_UNAVAILABLE = new Set(["P1001", "P1002", "P1008", "P1011", "P1017", "P2024", "P2037"]);
/**
 * Prisma codes a fresh attempt resolves: write conflicts and deadlocks, and the
 * unique and missing-row errors a concurrent writer causes — in a job those
 * are nearly always a race another worker or a person won, and the next
 * attempt reads the state they left.
 */
const PRISMA_CONFLICT = new Set(["P2034", "P2002", "P2025"]);
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

/**
 * A message fit to store and log: one line, bounded, and never Prisma's
 * rendering of a query — that repeats the arguments, which can be a document
 * name or a note (§37, §122).
 */
function safeMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = (error.meta as { target?: unknown; modelName?: unknown } | undefined) ?? {};
    const detail = [target.modelName, Array.isArray(target.target) ? target.target.join(",") : target.target].filter(Boolean).join(" ");
    return `prisma ${error.code}${detail ? ` (${detail})` : ""}`;
  }
  if (error instanceof Prisma.PrismaClientValidationError) return "prisma query validation failed";
  if (error instanceof Prisma.PrismaClientInitializationError) return `prisma could not connect${error.errorCode ? ` (${error.errorCode})` : ""}`;
  if (error instanceof Prisma.PrismaClientRustPanicError || error instanceof Prisma.PrismaClientUnknownRequestError) return "prisma engine error";
  if (error instanceof ZodError) return `invalid input: ${error.issues.map((issue) => issue.path.join(".") || "(root)").slice(0, 5).join(", ")}`;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "unknown error";
}

function causeCode(error: unknown): string | undefined {
  const withCode = (value: unknown) => (value && typeof value === "object" && "code" in value ? String((value as { code: unknown }).code) : undefined);
  return withCode(error) ?? withCode(error instanceof Error ? error.cause : undefined);
}

export function classifyJobError(error: unknown): ClassifiedError {
  const message = safeMessage(error);
  if (error instanceof JobError) return { code: error.code, retryable: error.retryable, message };

  if (error instanceof Prisma.PrismaClientInitializationError) return { code: "DATABASE_UNAVAILABLE", retryable: true, message };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (PRISMA_UNAVAILABLE.has(error.code)) return { code: "DATABASE_UNAVAILABLE", retryable: true, message };
    if (PRISMA_CONFLICT.has(error.code)) return { code: "DATABASE_CONFLICT", retryable: true, message };
    // A constraint the data breaks will break the same way next time.
    if (error.code.startsWith("P2")) return { code: "VALIDATION", retryable: false, message };
  }
  if (error instanceof Prisma.PrismaClientValidationError) return { code: "VALIDATION", retryable: false, message };
  if (error instanceof ZodError) return { code: "VALIDATION", retryable: false, message };

  if (error instanceof AccessError) {
    // A storage provider that failed is the one AccessError worth another try.
    if (error.status >= 500) return { code: error.name === "StorageError" ? "STORAGE_UNAVAILABLE" : "UNKNOWN", retryable: true, message };
    if (error.code === "CONFLICT") return { code: "STATE_CONFLICT", retryable: false, message };
    if (["NOT_FOUND", "MODULE_UNAVAILABLE", "COMPANY_INACTIVE", "MEMBERSHIP_INACTIVE"].includes(error.code)) return { code: "NOT_ELIGIBLE", retryable: false, message };
    return { code: "VALIDATION", retryable: false, message };
  }

  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return { code: "TIMEOUT", retryable: true, message };
  const code = causeCode(error);
  if (code && NETWORK_CODES.has(code)) return { code: "NETWORK", retryable: true, message };
  if (/fetch failed|socket hang up|network|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message)) return { code: "NETWORK", retryable: true, message };

  // Unknown is retried, and max attempts is what stops it (§34).
  return { code: "UNKNOWN", retryable: true, message };
}
