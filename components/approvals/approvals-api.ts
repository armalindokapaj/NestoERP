"use client";

import { apiFailureMessage, apiFailureOutcome, apiRequest, isApiFailure, type ApiFailure as SharedApiFailure, type ApiRequestInit } from "@/lib/client/api-request";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * The browser side of the Approvals Center API. Every call answers with the
 * data or throws a failure carrying the server's message and its code — the
 * server has already decided; this only relays it.
 */

export type ApprovalsApiFailure = SharedApiFailure;

/**
 * Through the shared transport (AUD-07 §7): a deadline, one retry for a failed
 * read, never a replay of a decision. A decision that got no answer may still
 * have been recorded: it is never reported as "nothing decided". Trying again
 * reuses the attempt's idempotency key, so it cannot be recorded twice
 * (PRD #41 §123; AUD-04 §6, MW-15).
 */
export function approvalsApi<T>(url: string, init?: { method?: string; body?: unknown; idempotencyKey?: string } & Pick<ApiRequestInit, "signal">): Promise<T> {
  const { idempotencyKey, ...rest } = init ?? {};
  return apiRequest<T>(url, {
    ...rest,
    headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
    cache: "no-store",
    messageFrom: "field",
    unconfirmedMessage: idempotencyKey
      ? "We couldn't confirm whether this was recorded. Check your connection and try again; it will not be recorded twice."
      : undefined,
  });
}

export function isFailure(error: unknown): error is ApprovalsApiFailure {
  return isApiFailure(error);
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return apiFailureMessage(error, fallback);
}

/** A key per decision attempt, reused when the same attempt is retried (PRD #41 §123). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `apr_${crypto.randomUUID()}`;
  return `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * What a thrown call means for unsaved work (AUD-03 §6): the server's answer is
 * a definite refusal; a request that never got an answer may have committed.
 */
export function approvalsFailureOutcome(error: unknown): SaveOutcome {
  return apiFailureOutcome(error);
}
