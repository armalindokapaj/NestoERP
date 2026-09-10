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
  | "FORBIDDEN"
  | "MODULE_UNAVAILABLE"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  MODULE_UNAVAILABLE: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

const MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: "You are not signed in.",
  FORBIDDEN: "You do not have permission to perform this action.",
  MODULE_UNAVAILABLE: "This module is not enabled for your company.",
  NOT_FOUND: "The requested record could not be found.",
  VALIDATION_ERROR: "Some of the supplied values are not valid.",
  CONFLICT: "That change conflicts with an existing record.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

/**
 * Thrown by services; translated into an HTTP response by the route handler.
 * Messages are safe to show a user: no SQL, no stack traces, no permission
 * implementation details (PRD #7 §149).
 */
export class AccessError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message?: string, details?: unknown) {
    super(message ?? MESSAGES[code]);
    this.name = "AccessError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
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
