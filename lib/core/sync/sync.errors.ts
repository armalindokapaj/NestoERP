import { ZodError } from "zod";

import { AccessError } from "@/lib/access/guards";

import type { SyncErrorType, SyncOutcome } from "./protocol";

export type ClassifiedFailure = {
  result: Extract<SyncOutcome, "CONFLICT" | "REJECTED" | "RETRY">;
  errorType: SyncErrorType;
  code: string;
  message: string;
};

/**
 * Turns whatever a service threw into the answer the device acts on (MOB-09 §85, §86).
 *
 * The message is the service's own (it is already written for a person and
 * discloses nothing the caller could not see); anything unexpected is a
 * generic temporary failure — internals never reach the device (PRD #7 §149).
 */
export function classifyFailure(error: unknown): ClassifiedFailure {
  if (error instanceof ZodError) {
    return { result: "REJECTED", errorType: "VALIDATION", code: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "Some of the values are not valid." };
  }
  if (error instanceof AccessError) {
    const details = error.details as { code?: unknown } | undefined;
    const code = typeof details?.code === "string" ? details.code : error.code;
    const base = { code, message: error.message };
    switch (error.code) {
      case "CONFLICT":
        return { result: "CONFLICT", errorType: "CONFLICT", ...base };
      case "VALIDATION_ERROR":
      case "PRECONDITION_REQUIRED":
        return { result: "REJECTED", errorType: "VALIDATION", ...base };
      case "UNAUTHENTICATED":
      case "WORKSPACE_COMPANY_REQUIRED":
        return { result: "REJECTED", errorType: "AUTH", ...base };
      case "FORBIDDEN":
      case "MODULE_UNAVAILABLE":
      case "MEMBERSHIP_INACTIVE":
      case "COMPANY_INACTIVE":
      case "NOT_FOUND":
        return { result: "REJECTED", errorType: "PERMISSION", ...base };
      case "TEMPORARILY_UNAVAILABLE":
        return { result: "RETRY", errorType: "SERVER_TEMPORARY", ...base };
      default:
        return { result: "RETRY", errorType: "SERVER_TEMPORARY", code: "INTERNAL_ERROR", message: "The server could not finish this just now." };
    }
  }
  return { result: "RETRY", errorType: "SERVER_TEMPORARY", code: "INTERNAL_ERROR", message: "The server could not finish this just now." };
}
