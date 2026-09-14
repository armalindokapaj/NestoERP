"use client";

/**
 * The browser side of the Approvals Center API. Every call answers with the
 * data or throws a failure carrying the server's message and its code — the
 * server has already decided; this only relays it.
 */

export type ApprovalsApiFailure = { status: number; code: string; message: string; detailCode?: string; fields: Record<string, string> };

export async function approvalsApi<T>(url: string, init?: { method?: string; body?: unknown; idempotencyKey?: string }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init?.idempotencyKey ? { "idempotency-key": init.idempotencyKey } : {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw { status: 0, code: "NETWORK", message: "Check your connection and try again. Nothing was decided.", fields: {} } satisfies ApprovalsApiFailure;
  }
  const json = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message?: string; details?: Record<string, unknown> } } | null;
  if (!response.ok) {
    const details = json?.error?.details ?? {};
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(details)) {
      if (Array.isArray(value) && typeof value[0] === "string") fields[key] = value[0];
    }
    throw {
      status: response.status,
      code: json?.error?.code ?? "INTERNAL_ERROR",
      message: Object.values(fields)[0] ?? json?.error?.message ?? "Something went wrong.",
      detailCode: typeof details.code === "string" ? details.code : undefined,
      fields,
    } satisfies ApprovalsApiFailure;
  }
  return (json?.data ?? (json as T)) as T;
}

export function isFailure(error: unknown): error is ApprovalsApiFailure {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return isFailure(error) ? error.message : fallback;
}

/** A key per decision attempt, reused when the same attempt is retried (PRD #41 §123). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `apr_${crypto.randomUUID()}`;
  return `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
