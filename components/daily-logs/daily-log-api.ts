"use client";

import { apiFailureMessage, apiFailureOutcome, apiRequest, isApiFailure, type ApiFailure as SharedApiFailure, type ApiRequestInit } from "@/lib/client/api-request";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * The browser side of the daily logs API. Every call answers with the data or
 * throws a failure carrying the server's message and code — the server has
 * already decided; this only relays it.
 */

export type DailyLogApiFailure = SharedApiFailure;

/** Through the shared transport: a deadline, one retry for a failed read, never for a write (AUD-07 §7). */
export function dailyLogApi<T>(url: string, init?: { method?: string; body?: unknown } & Pick<ApiRequestInit, "signal">): Promise<T> {
  return apiRequest<T>(url, { ...init, messageFrom: "field" });
}

export function isFailure(error: unknown): error is DailyLogApiFailure {
  return isApiFailure(error);
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return apiFailureMessage(error, fallback);
}

/**
 * What a thrown call means for unsaved work (AUD-03 §6): the server's answer is
 * a definite refusal; a request that never got an answer may have committed.
 */
export function dailyLogFailureOutcome(error: unknown): SaveOutcome {
  return apiFailureOutcome(error);
}
