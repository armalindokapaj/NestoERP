"use client";

import { apiFailureOutcome, apiRequest, type ApiFailure as SharedApiFailure, type ApiRequestInit } from "@/lib/client/api-request";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * The browser side of the meetings API. Every call answers with the data or
 * throws a failure carrying the server's message, its code and the first field
 * error — the server has already decided; this only relays it.
 */

export type MeetingApiFailure = SharedApiFailure;

/** Through the shared transport: a deadline, one retry for a failed read, never for a write (AUD-07 §7). */
export function meetingApi<T>(url: string, init?: { method?: string; body?: unknown } & Pick<ApiRequestInit, "signal">): Promise<T> {
  return apiRequest<T>(url, { ...init, messageFrom: "field" });
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return typeof error === "object" && error !== null && "message" in error ? String((error as MeetingApiFailure).message) : fallback;
}

/**
 * What a thrown call means for unsaved work (AUD-03 §6): the server's answer is
 * a definite refusal; a request that never got an answer may have committed.
 */
export function meetingFailureOutcome(error: unknown): SaveOutcome {
  return apiFailureOutcome(error);
}
