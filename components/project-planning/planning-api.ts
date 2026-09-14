"use client";

/**
 * The browser side of the planning API. Every call answers with the data or
 * throws a failure carrying the server's message and code — the server has
 * already decided; this only relays it.
 */

export type PlanningApiFailure = { status: number; code: string; message: string; detailCode?: string; details: Record<string, unknown> };

export async function planningApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw { status: 0, code: "NETWORK", message: "Check your connection and try again.", details: {} } satisfies PlanningApiFailure;
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
    } satisfies PlanningApiFailure;
  }
  return (json?.data ?? (json as T)) as T;
}

export function isFailure(error: unknown): error is PlanningApiFailure {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return isFailure(error) ? error.message : fallback;
}
