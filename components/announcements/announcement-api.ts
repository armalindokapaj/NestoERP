"use client";

import { apiFailureMessage, apiFailureOutcome, apiRequest, isApiFailure, type ApiFailure as SharedApiFailure, type ApiRequestInit } from "@/lib/client/api-request";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * The browser side of the announcements, favorites and recent work APIs. Every call answers with the data or
 * throws a failure carrying the server's message and code — the server has
 * already decided; this only relays it.
 */

export type ApiFailure = SharedApiFailure;

/** Through the shared transport: a deadline, one retry for a failed read, never for a write (AUD-07 §7). */
export function announcementApi<T>(url: string, init?: { method?: string; body?: unknown } & Pick<ApiRequestInit, "signal">): Promise<T> {
  return apiRequest<T>(url, { ...init, messageFrom: "field" });
}

export function isFailure(error: unknown): error is ApiFailure {
  return isApiFailure(error);
}

/** Without a `fallback` of the caller's own, a failure that carries no message reads as the shared transport's generic line. */
export function failureMessage(error: unknown, fallback?: string): string {
  return apiFailureMessage(error, fallback);
}

/**
 * What a thrown call means for unsaved work (AUD-03 §6): the server's answer is
 * a definite refusal; a request that never got an answer may have committed.
 */
export function announcementFailureOutcome(error: unknown): SaveOutcome {
  return apiFailureOutcome(error);
}
