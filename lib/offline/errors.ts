import type { SyncErrorType } from "@/lib/core/sync/protocol";

/**
 * The device's side of the error classes (MOB-09 §85, §86): what a failed
 * request means, and what the queue does about each kind.
 */

export type HttpFailure = { errorType: SyncErrorType; code: string; message: string };

export function classifyHttp(status: number, body: unknown): HttpFailure {
  const error = (body as { error?: { code?: string; message?: string; details?: { code?: string } } } | null)?.error;
  const code = error?.details?.code ?? error?.code ?? `HTTP_${status}`;
  const message = error?.message ?? "The server could not finish this.";
  if (status === 0) return { errorType: "NETWORK", code: "NETWORK", message: "No connection." };
  if (status === 401) return { errorType: "AUTH", code, message };
  if (status === 426) return { errorType: "UNSUPPORTED_VERSION", code: "UPDATE_REQUIRED", message: "Update NESTO to sync these changes." };
  if (status === 403 || status === 404) return { errorType: "PERMISSION", code, message };
  if (status === 409) return { errorType: code === "WORKSPACE_COMPANY_REQUIRED" || code === "WORKSPACE_CHANGED" ? "AUTH" : "CONFLICT", code, message };
  if (status === 422 || status === 428 || status === 400) return { errorType: "VALIDATION", code, message };
  return { errorType: "SERVER_TEMPORARY", code, message: "The server could not finish this just now." };
}

/** Network and temporary failures come back on their own; everything else waits for a person (§32, §33). */
export function needsAttention(type: SyncErrorType): boolean {
  return type === "PERMISSION" || type === "VALIDATION" || type === "CONFLICT" || type === "FILE_ERROR";
}

export const MAX_AUTOMATIC_RETRIES = 8;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/** Exponential backoff with jitter; `random` is injectable so the schedule can be tested (§32). */
export function backoffDelay(retryCount: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, retryCount));
  return Math.round(exponential * (0.75 + random() * 0.5));
}

/** The server stopped recognising this person's access (or their session) while a download or refresh was running. */
export class ProjectAccessError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "You are signed out." : "This project is not available to you.");
  }
}
