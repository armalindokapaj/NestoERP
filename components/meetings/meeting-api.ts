"use client";

/**
 * The browser side of the meetings API. Every call answers with the data or
 * throws a failure carrying the server's message, its code and the first field
 * error — the server has already decided; this only relays it.
 */

export type MeetingApiFailure = { status: number; code: string; message: string; detailCode?: string; fields: Record<string, string> };

export async function meetingApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw { status: 0, code: "NETWORK", message: "Check your connection and try again.", fields: {} } satisfies MeetingApiFailure;
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
    } satisfies MeetingApiFailure;
  }
  return (json?.data ?? (json as T)) as T;
}

export function failureMessage(error: unknown, fallback = "Something went wrong."): string {
  return typeof error === "object" && error !== null && "message" in error ? String((error as MeetingApiFailure).message) : fallback;
}
