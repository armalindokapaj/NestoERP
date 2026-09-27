"use client";

import { apiFailureMessage, apiRequest, isApiFailure, type ApiFailure as SharedApiFailure, type ApiRequestInit } from "@/lib/client/api-request";

/**
 * The browser side of the timesheets API. Every call answers with the data or
 * throws a failure carrying the server's message and code — the server has
 * already decided; this only relays it.
 */

export type TimesheetApiFailure = SharedApiFailure;

/** Through the shared transport: a deadline, one retry for a failed read, never for a write (AUD-07 §7). */
export function timesheetApi<T>(url: string, init?: { method?: string; body?: unknown } & Pick<ApiRequestInit, "signal">): Promise<T> {
  return apiRequest<T>(url, { ...init, messageFrom: "field" });
}

export function isFailure(error: unknown): error is TimesheetApiFailure {
  return isApiFailure(error);
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return apiFailureMessage(error, fallback);
}
