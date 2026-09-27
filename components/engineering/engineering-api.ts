"use client";

import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { outcomeOf } from "@/lib/unsaved/outcome";

/**
 * The browser side of the contractor and engineering APIs. Every call answers
 * with the data or throws a failure carrying the server's message, code and
 * field errors — the server has already decided; this only relays it.
 */

export type ApiFailure = { status: number; code: string; message: string; detailCode?: string; details: Record<string, unknown>; fieldErrors?: Record<string, string[]> };

export async function engineeringApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw { status: 0, code: "NETWORK", message: "Check your connection and try again.", details: {} } satisfies ApiFailure;
  }
  const json = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message?: string; details?: Record<string, unknown>; fieldErrors?: Record<string, string[]> } } | null;
  if (!response.ok) {
    const details = json?.error?.details ?? {};
    // The envelope's own form-level sentence (AUD-09 §3, §6). The first list in
    // `details` used to stand in for it, and a list of field names — a frozen
    // submittal's `fields` — became the message.
    throw {
      status: response.status,
      code: json?.error?.code ?? (response.status === 502 || response.status === 504 ? "UNCONFIRMED" : "INTERNAL_ERROR"),
      message: json?.error?.message ?? "Something went wrong.",
      detailCode: typeof details.code === "string" ? details.code : undefined,
      details,
      ...(json?.error?.fieldErrors ? { fieldErrors: json.error.fieldErrors } : {}),
    } satisfies ApiFailure;
  }
  return (json?.data ?? (json as T)) as T;
}

export function isFailure(error: unknown): error is ApiFailure {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return isFailure(error) ? error.message : fallback;
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
  // No answer, or a gateway that gave up (502, 504): the change may have gone through (AUD-03 §6, AUD-09 §6, FV-13).
  if (!isFailure(error) || error.status === 0 || error.status === 502 || error.status === 504) return { kind: "unknown" };
  const outcome = outcomeOf({ ok: false, code: error.code, error: error.message });
  return outcome.kind === "invalid" && error.detailCode ? outcomeOf({ ok: false, code: error.detailCode, error: error.message }) : outcome;
}
