"use client";

/**
 * The browser side of the contractor and engineering APIs. Every call answers
 * with the data or throws a failure carrying the server's message, code and
 * field errors — the server has already decided; this only relays it.
 */

export type ApiFailure = { status: number; code: string; message: string; detailCode?: string; details: Record<string, unknown> };

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
  const json = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message?: string; details?: Record<string, unknown> } } | null;
  if (!response.ok) {
    const details = json?.error?.details ?? {};
    const field = Object.values(details).find((value): value is string[] => Array.isArray(value) && typeof value[0] === "string");
    throw {
      status: response.status,
      code: json?.error?.code ?? "INTERNAL_ERROR",
      message: field?.[0] ?? json?.error?.message ?? "Something went wrong.",
      detailCode: typeof details.code === "string" ? details.code : undefined,
      details,
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

/** Field-level messages, from zod's flattened errors or a service's `field`. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!isFailure(error)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(error.details)) if (Array.isArray(value) && typeof value[0] === "string") result[key] = value[0];
  if (typeof error.details.field === "string") result[error.details.field] = error.message;
  return result;
}
