"use client";

import { apiFailureMessage, apiFailureOutcome, apiRequest, isApiFailure, type ApiFailure as SharedApiFailure, type ApiRequestInit } from "@/lib/client/api-request";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * The browser side of the contractor and engineering APIs. Every call answers
 * with the data or throws a failure carrying the server's message, code and
 * field errors — the server has already decided; this only relays it.
 */

/** The shared failure; `fields` optional, as the upload flows build this shape by hand. */
export type ApiFailure = Omit<SharedApiFailure, "fields"> & Partial<Pick<SharedApiFailure, "fields">>;

/** Through the shared transport: a deadline, one retry for a failed read, never for a write (AUD-07 §7). */
export function engineeringApi<T>(url: string, init?: { method?: string; body?: unknown } & Pick<ApiRequestInit, "signal">): Promise<T> {
  return apiRequest<T>(url, { ...init, messageFrom: "envelope" });
}

export function isFailure(error: unknown): error is ApiFailure {
  return isApiFailure(error);
}

/** Without a `fallback` of the caller's own, a failure that carries no message reads as the shared transport's generic line. */
export function failureMessage(error: unknown, fallback?: string): string {
  return apiFailureMessage(error, fallback);
}

/**
 * Field-level messages: the envelope's `fieldErrors` under their full paths
 * (AUD-09 §3), else zod's flattened `details` or a service's `field`. Only
 * lists keyed by a field count — `fields: [...]` naming what changed is not
 * an error on a field called "fields".
 */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!isFailure(error)) return {};
  const result: Record<string, string> = {};
  if (error.fieldErrors) {
    for (const [key, value] of Object.entries(error.fieldErrors)) if (Array.isArray(value) && typeof value[0] === "string") result[key] = value[0];
    return result;
  }
  if (error.code === "VALIDATION_ERROR") for (const [key, value] of Object.entries(error.details)) if (Array.isArray(value) && typeof value[0] === "string") result[key] = value[0];
  if (typeof error.details.field === "string") result[error.details.field] = error.message;
  return result;
}

/**
 * What a thrown call means for unsaved work (AUD-03 §6): the server's answer is
 * a definite refusal; a request that never got an answer may have committed.
 */
export function failureOutcome(error: unknown): SaveOutcome {
  return apiFailureOutcome(error);
}
