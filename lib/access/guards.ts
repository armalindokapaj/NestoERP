import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "./can";
import type { UserContext } from "@/lib/context/types";

/**
 * API-layer guards (PRD #5 §58, PRD #7 §66).
 *
 * Hiding a control in the UI is not security (PRD #3 §102) — every route
 * handler runs this sequence before it touches data:
 *
 *   authenticate → resolve context → company active → membership active
 *   → module enabled → permission → scope → execute
 */

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "MEMBERSHIP_INACTIVE"
  | "COMPANY_INACTIVE"
  /** The Group workspace is active and this needs one company (Workspace Context §25, §29). */
  | "WORKSPACE_COMPANY_REQUIRED"
  | "FORBIDDEN"
  | "MODULE_UNAVAILABLE"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  /** A write that must name the version it was based on, and did not (AUD-02 §6). */
  | "PRECONDITION_REQUIRED"
  /** A transient failure that left nothing behind; the same request may be tried again (AUD-02 §4, §6). */
  | "TEMPORARILY_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  MEMBERSHIP_INACTIVE: 403,
  COMPANY_INACTIVE: 403,
  WORKSPACE_COMPANY_REQUIRED: 409,
  FORBIDDEN: 403,
  MODULE_UNAVAILABLE: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  PRECONDITION_REQUIRED: 428,
  TEMPORARILY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

const MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: "You are not signed in.",
  MEMBERSHIP_INACTIVE: "Your workspace is unavailable.",
  COMPANY_INACTIVE: "Your workspace is unavailable.",
  WORKSPACE_COMPANY_REQUIRED: "Choose a company to do this.",
  FORBIDDEN: "You do not have permission to perform this action.",
  MODULE_UNAVAILABLE: "This module is not enabled for your company.",
  NOT_FOUND: "The requested record could not be found.",
  VALIDATION_ERROR: "Some of the supplied values are not valid.",
  CONFLICT: "That change conflicts with an existing record.",
  PRECONDITION_REQUIRED: "Reload the record and try again.",
  TEMPORARILY_UNAVAILABLE: "The change could not be completed just now. Nothing was saved; try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

/**
 * Why an authorisation decision refused (PRD #47 §118).
 *
 * Internal only: it reaches the security log and the denial metrics, never the
 * response body, which keeps to the public code and a safe message (§116, §224).
 */
export const SECURITY_REASON_CODES = [
  "UNAUTHENTICATED",
  "MEMBERSHIP_INACTIVE",
  "COMPANY_INACTIVE",
  "MODULE_DISABLED",
  "PERMISSION_DENIED",
  "SCOPE_DENIED",
  "RECORD_DENIED",
  "STATE_DENIED",
  "CROSS_COMPANY_REFERENCE",
  "CROSS_PROJECT_REFERENCE",
  // A write from a tab that still renders another workspace (AUD-03 §7).
  "STALE_WORKSPACE",
] as const;
export type SecurityReasonCode = (typeof SECURITY_REASON_CODES)[number];

/** The reason a code implies when the thrower did not name a sharper one. */
const DEFAULT_REASON: Partial<Record<ApiErrorCode, SecurityReasonCode>> = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  MEMBERSHIP_INACTIVE: "MEMBERSHIP_INACTIVE",
  COMPANY_INACTIVE: "COMPANY_INACTIVE",
  FORBIDDEN: "PERMISSION_DENIED",
  MODULE_UNAVAILABLE: "MODULE_DISABLED",
  // A record that answers "not found" to somebody who may not see it is a
  // refusal, not a missing row, and is counted as one (PRD #47 §114, §196).
  NOT_FOUND: "RECORD_DENIED",
};

/**
 * The same defaulting the security log applies to a refusal that never came
 * through an `AccessError` — a context that would not resolve, refused before
 * any service ran (PRD #47 §13, §117).
 */
export function defaultSecurityReason(code: ApiErrorCode): SecurityReasonCode | undefined {
  return DEFAULT_REASON[code];
}

/**
 * Thrown by services; translated into an HTTP response by the route handler.
 * Messages are safe to show a user: no SQL, no stack traces, no permission
 * implementation details (PRD #7 §149).
 */
export class AccessError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** The security reason behind a refusal, for logs and metrics only (PRD #47 §117, §118). */
  readonly reason?: SecurityReasonCode;

  constructor(code: ApiErrorCode, message?: string, details?: unknown, reason?: SecurityReasonCode) {
    super(message ?? MESSAGES[code]);
    this.name = "AccessError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
    this.reason = reason ?? DEFAULT_REASON[code];
  }
}

export function assertPermission(context: UserContext, permission: Permission): void {
  if (!can(context, permission)) throw new AccessError("FORBIDDEN");
}

export function assertModule(context: UserContext, moduleKey: ModuleKey): void {
  if (!isModuleEnabled(context, moduleKey)) throw new AccessError("MODULE_UNAVAILABLE");
  if (!canAccessModule(context, moduleKey)) throw new AccessError("FORBIDDEN");
}

/**
 * A linked record the caller may not use: another company's, another
 * project's, or simply one they cannot see (PRD #47 §20, §21, §50, §51, §62).
 *
 * Answers like any other invalid field — 422, naming the field — and never
 * says whether the id exists somewhere else, so it cannot be used to probe.
 */
export function invalidRecordLink(
  field: string,
  reason: Extract<SecurityReasonCode, "CROSS_COMPANY_REFERENCE" | "CROSS_PROJECT_REFERENCE" | "SCOPE_DENIED"> = "CROSS_COMPANY_REFERENCE",
  message = reason === "CROSS_PROJECT_REFERENCE" ? "Choose a record from the same project." : "Choose a record you have access to.",
): AccessError {
  return new AccessError("VALIDATION_ERROR", message, { [field]: [message] }, reason);
}

/** A record whose current state does not allow the action (PRD #47 §85-§87). */
export function stateDenied(message: string, details?: unknown): AccessError {
  return new AccessError("CONFLICT", message, details, "STATE_DENIED");
}

/**
 * A record that exists but sits outside the caller's scope answers 404, not
 * 403 — otherwise the response itself confirms the record exists
 * (PRD #7 §60, PRD #10 §113).
 */
export function assertFound<T>(record: T | null | undefined): T {
  if (record === null || record === undefined) throw new AccessError("NOT_FOUND");
  return record;
}

export function errorStatus(code: ApiErrorCode): number {
  return STATUS[code];
}
