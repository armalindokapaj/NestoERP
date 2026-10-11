"use client";

import { apiFailureMessage, apiRequest, isApiFailure, type ApiFailure as SharedApiFailure, type ApiRequestInit } from "@/lib/client/api-request";

/**
 * The browser side of the planning API. Every call answers with the data or
 * throws a failure carrying the server's message and code — the server has
 * already decided; this only relays it.
 */

export type PlanningApiFailure = SharedApiFailure;

/** Through the shared transport: a deadline, one retry for a failed read, never for a write (AUD-07 §7). */
export function planningApi<T>(url: string, init?: { method?: string; body?: unknown } & Pick<ApiRequestInit, "signal">): Promise<T> {
  return apiRequest<T>(url, { ...init, messageFrom: "field" });
}

export function isFailure(error: unknown): error is PlanningApiFailure {
  return isApiFailure(error);
}

/** Without a `fallback` of the caller's own, a failure that carries no message reads as the shared transport's generic line. */
export function failureMessage(error: unknown, fallback?: string): string {
  return apiFailureMessage(error, fallback);
}

/**
 * A number field's payload (AUD-09 §4, FV-06): empty is "none", not zero; a
 * number is sent as one; anything else goes as typed so the server refuses it
 * on the field — `Number("abc")` is NaN, which JSON sends as `null` and would
 * quietly clear the value.
 *
 * AUD-09: candidate for lib/forms.
 */
export function numberOrRaw(raw: unknown): unknown {
  if (raw === "" || raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : text;
}
