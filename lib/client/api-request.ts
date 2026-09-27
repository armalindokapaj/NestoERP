import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY, outcomeOf } from "@/lib/unsaved/outcome";

/**
 * The browser's one way to call a NESTO JSON API (AUD-07 §7, PS-13..PS-16).
 *
 * The module helpers (engineering, approvals, timesheets, daily logs, planning,
 * announcements, meetings) used to be seven copies of the same `fetch`, with no
 * deadline — a hung request kept its spinner forever — and no rule for what a
 * failed read may do next. They now all come through here, and the rules live
 * in one place:
 *
 *  Reads (GET, HEAD) — safe to repeat:
 *   - A 10-second deadline for the whole call, retry included (READ_DEADLINE_MS).
 *     The server's own layers finish inside it: a transaction waits at most 2 s
 *     for a connection and runs at most 5 s (lib/core/transactions/transaction.ts).
 *   - At most one automatic retry, and only for what a retry can fix: no answer,
 *     a 5xx, a 408, or a 429 whose Retry-After fits in what is left of the deadline.
 *     A jittered pause first, so a failing server is not hit in lockstep.
 *   - Never a retry for 400/401/403/404/409/422/428: the answer will not change.
 *   - A timeout, or a caller's abort, ends the call; nothing keeps loading.
 *
 *  Writes (everything else) — never repeated here:
 *   - Sent once. No automatic replay, whatever happens (PRD §7).
 *   - A 30-second deadline (WRITE_DEADLINE_MS). Past it, or on a lost connection,
 *     or a gateway's 5xx with no NESTO envelope, the outcome is UNKNOWN — the
 *     change may have committed — never "failed" and never "rolled back". The
 *     caller keeps the draft and offers to check the record (AUD-03 §6).
 *
 * Every failure is thrown as an `ApiFailure`; `apiFailureOutcome` turns one into
 * the AUD-03 save outcome. This module adds no cache and no idempotency of its
 * own — those stay with the server (PRD §6, §7).
 */

export const READ_DEADLINE_MS = 10_000;
export const WRITE_DEADLINE_MS = 30_000;
/** Below this much time left, a retry could not finish; the call ends instead. */
const MIN_RETRY_BUDGET_MS = 1_000;
const RETRY_PAUSE_MS = { min: 200, spread: 400 } as const;

/** Statuses a repeated read cannot change (PRD §7, PS-14). */
const FINAL = new Set([400, 401, 403, 404, 409, 410, 422, 428]);

export type ApiFailure = {
  /** HTTP status; 0 when no response arrived (NETWORK, TIMEOUT, ABORTED). */
  status: number;
  code: string;
  message: string;
  detailCode?: string;
  details: Record<string, unknown>;
  /** The first message per field, from `details` (the approvals and meetings forms read this). */
  fields: Record<string, string>;
  /** The envelope's own per-field lists (AUD-09 §3). */
  fieldErrors?: Record<string, string[]>;
  /** From a 429's Retry-After, when one was given. */
  retryAfterSeconds?: number;
};

export type ApiRequestInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Aborts the call, e.g. when a newer search replaces it; the call then throws ABORTED. */
  signal?: AbortSignal;
  /** Overrides the default deadline; long uploads, exports and previews set their own (PRD §7). */
  deadlineMs?: number;
  cache?: RequestCache;
  /**
   * Which sentence a refusal leads with: the envelope's form-level `message`
   * (engineering, AUD-09 §6), or the first field's message (the older helpers).
   */
  messageFrom?: "envelope" | "field";
  /** What a write that got no answer says, when the caller knows more (approvals are idempotent). */
  unconfirmedMessage?: string;
  /** Test seam: the pause before a retry. */
  sleep?: (ms: number) => Promise<void>;
};

const READ_METHODS = new Set(["GET", "HEAD"]);

export const API_COPY = {
  readNetwork: "Check your connection and try again.",
  readTimeout: "This is taking longer than expected. Try again.",
  aborted: "The request was replaced by a newer one.",
  rateLimited: (seconds?: number) => (seconds ? `Too many requests. Try again in ${seconds} seconds.` : "Too many requests. Try again in a moment."),
  generic: "Something went wrong.",
} as const;

type Envelope = { data?: unknown; error?: { code?: string; message?: string; details?: Record<string, unknown>; fieldErrors?: Record<string, string[]> } };

export async function apiRequest<T>(url: string, init: ApiRequestInit = {}): Promise<T> {
  const method = (init.method ?? (init.body === undefined ? "GET" : "POST")).toUpperCase();
  const read = READ_METHODS.has(method);
  const deadlineMs = init.deadlineMs ?? (read ? READ_DEADLINE_MS : WRITE_DEADLINE_MS);
  const endsAt = Date.now() + deadlineMs;
  const sleep = init.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers: Record<string, string> = { ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers };

  for (let attempt = 1; ; attempt += 1) {
    const outcome = await attemptOnce(url, { method, headers, body: init.body, signal: init.signal, cache: init.cache }, endsAt - Date.now());
    const canRetry = read && attempt === 1 && !init.signal?.aborted;

    if (outcome.kind === "aborted") throw transportFailure("ABORTED", API_COPY.aborted);
    if (outcome.kind === "timeout") {
      // The whole deadline is spent: there is no time for a retry (the user gets Retry instead).
      throw transportFailure(read ? "TIMEOUT" : "UNCONFIRMED", read ? API_COPY.readTimeout : init.unconfirmedMessage ?? OUTCOME_COPY.unknown);
    }
    if (outcome.kind === "network") {
      if (canRetry && endsAt - Date.now() > MIN_RETRY_BUDGET_MS) {
        await sleep(jitter());
        continue;
      }
      throw transportFailure(read ? "NETWORK" : "UNCONFIRMED", read ? API_COPY.readNetwork : init.unconfirmedMessage ?? OUTCOME_COPY.unknown);
    }

    const { response, json } = outcome;
    if (response.ok) return ((json as Envelope | null)?.data ?? json) as T;

    const failure = failureFrom(response, json as Envelope | null, read, init);
    if (canRetry && retryable(response.status)) {
      const pause = response.status === 429 ? (failure.retryAfterSeconds ?? 0) * 1000 || jitter() : jitter();
      // Only a pause that leaves time for the retry itself; otherwise the person decides.
      if (endsAt - Date.now() - pause > MIN_RETRY_BUDGET_MS) {
        await sleep(pause);
        continue;
      }
    }
    throw failure;
  }
}

type Attempt =
  | { kind: "response"; response: Response; json: unknown }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "aborted" };

async function attemptOnce(url: string, request: { method: string; headers: Record<string, string>; body: unknown; signal?: AbortSignal; cache?: RequestCache }, budgetMs: number): Promise<Attempt> {
  if (request.signal?.aborted) return { kind: "aborted" };
  if (budgetMs <= 0) return { kind: "timeout" };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, budgetMs);
  const forward = () => controller.abort();
  request.signal?.addEventListener("abort", forward, { once: true });
  try {
    const response = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
      ...(request.cache ? { cache: request.cache } : {}),
    });
    // The body is part of the answer: a stalled body is the same timeout. Raced
    // against the signal too, for a body stream that does not observe it.
    const json = await Promise.race([response.json().catch(() => null), whenAborted(controller.signal)]);
    if (controller.signal.aborted) return timedOut ? { kind: "timeout" } : { kind: "aborted" };
    return { kind: "response", response, json };
  } catch {
    if (timedOut) return { kind: "timeout" };
    if (request.signal?.aborted) return { kind: "aborted" };
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", forward);
  }
}

function whenAborted(signal: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(null);
    else signal.addEventListener("abort", () => resolve(null), { once: true });
  });
}

function retryable(status: number): boolean {
  if (FINAL.has(status)) return false;
  return status === 408 || status === 429 || (status >= 500 && status !== 501);
}

function jitter(): number {
  return RETRY_PAUSE_MS.min + Math.floor(Math.random() * RETRY_PAUSE_MS.spread);
}

function transportFailure(code: string, message: string): ApiFailure {
  return { status: 0, code, message, details: {}, fields: {} };
}

/** Retry-After as seconds or an HTTP date; nothing when absent or nonsense. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined;
}

function failureFrom(response: Response, json: Envelope | null, read: boolean, init: ApiRequestInit): ApiFailure {
  const error = json?.error;
  const details = error?.details ?? {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(details)) if (Array.isArray(value) && typeof value[0] === "string") fields[key] = value[0];
  const retryAfter = response.status === 429 ? retryAfterSeconds(response.headers.get("retry-after")) : undefined;
  // No NESTO envelope on a write's 5xx: a gateway or the host gave up, not the
  // application — the change may have gone through (AUD-03 §6, FV-13).
  const unconfirmed = !read && !error && response.status >= 500;
  const code = error?.code ?? (unconfirmed ? "UNCONFIRMED" : response.status === 429 ? "RATE_LIMITED" : "INTERNAL_ERROR");
  const firstField = Object.values(fields)[0];
  const message = unconfirmed
    ? init.unconfirmedMessage ?? OUTCOME_COPY.unknown
    : response.status === 429 && !error?.message
      ? API_COPY.rateLimited(retryAfter)
      : init.messageFrom === "envelope"
        ? error?.message ?? API_COPY.generic
        : firstField ?? error?.message ?? API_COPY.generic;
  return {
    status: response.status,
    code,
    message,
    detailCode: typeof details.code === "string" ? details.code : undefined,
    details,
    fields,
    ...(error?.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
  };
}

export function isApiFailure(error: unknown): error is ApiFailure {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

/** A read the caller replaced (a newer search, a closed panel): not an error to show. */
export function isAborted(error: unknown): boolean {
  return isApiFailure(error) && error.code === "ABORTED";
}

export function apiFailureMessage(error: unknown, fallback: string = API_COPY.generic): string {
  return isApiFailure(error) ? error.message : fallback;
}

/**
 * What a thrown write means for unsaved work (AUD-03 §6), in AUD-03's own terms
 * (lib/unsaved/outcome.ts): an answer from the application is definite; no
 * answer, a deadline, or a gateway's 5xx may have committed, so it is unknown.
 */
export function apiFailureOutcome(error: unknown): SaveOutcome {
  if (!isApiFailure(error) || error.status === 0 || error.status === 502 || error.status === 504 || error.code === "UNCONFIRMED") return { kind: "unknown" };
  const outcome = outcomeOf({ ok: false, code: error.code, error: error.message });
  return outcome.kind === "invalid" && error.detailCode ? outcomeOf({ ok: false, code: error.detailCode, error: error.message }) : outcome;
}
