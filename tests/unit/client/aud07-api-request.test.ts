import { afterEach, describe, expect, it, vi } from "vitest";

import { dailyLogApi } from "@/components/daily-logs/daily-log-api";
import { engineeringApi } from "@/components/engineering/engineering-api";
import { apiFailureOutcome, apiRequest, isAborted, READ_DEADLINE_MS, retryAfterSeconds, WRITE_DEADLINE_MS, type ApiFailure } from "@/lib/client/api-request";
import { LatestRequest } from "@/lib/client/latest-request";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";

/**
 * The browser's failure and recovery contract (AUD-07 §7; PS-10, PS-13, PS-14,
 * PS-15, PS-16). `fetch` is replaced per test; the pause before a retry is
 * recorded rather than slept, so the tests assert how long a retry would wait
 * without waiting for it.
 */

type Reply = Response | "network" | "hang";

function serve(...replies: Reply[]) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method) });
    const reply = replies.shift() ?? replies.at(-1) ?? "network";
    if (reply === "network") throw new TypeError("Failed to fetch");
    if (reply === "hang") {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return reply;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const envelope = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => json(status, { error: { code, message, details } });
const bare = (status: number) => new Response("<html>gateway</html>", { status });

function recorder() {
  const pauses: number[] = [];
  return { pauses, sleep: async (ms: number) => void pauses.push(ms) };
}

async function failureOf(promise: Promise<unknown>): Promise<ApiFailure> {
  try {
    await promise;
  } catch (error) {
    return error as ApiFailure;
  }
  throw new Error("expected the call to fail");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AUD-07 deadlines", () => {
  it("gives an interactive read 10 s and a write 30 s", () => {
    expect(READ_DEADLINE_MS).toBe(10_000);
    expect(WRITE_DEADLINE_MS).toBe(30_000);
  });
});

describe("AUD-07 PS-13: transient read failures", () => {
  it("retries a 5xx read once, after a jittered pause, and returns the data", async () => {
    const calls = serve(envelope(500, "INTERNAL_ERROR", "boom"), json(200, { data: { rows: [1] } }));
    const { pauses, sleep } = recorder();
    await expect(apiRequest("/api/x", { sleep })).resolves.toEqual({ rows: [1] });
    expect(calls).toHaveLength(2);
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toBeGreaterThanOrEqual(200);
    expect(pauses[0]).toBeLessThan(600);
  });

  it("stops after one retry: two 5xx answers end in the failure, not a loop", async () => {
    const calls = serve(envelope(503, "TEMPORARILY_UNAVAILABLE", "busy"), envelope(503, "TEMPORARILY_UNAVAILABLE", "busy"), json(200, { data: 1 }));
    const failure = await failureOf(apiRequest("/api/x", { sleep: recorder().sleep }));
    expect(calls).toHaveLength(2);
    expect(failure).toMatchObject({ status: 503, code: "TEMPORARILY_UNAVAILABLE" });
  });

  it("retries a lost connection once, then reports it for a manual Retry", async () => {
    const calls = serve("network", "network");
    const failure = await failureOf(apiRequest("/api/x", { sleep: recorder().sleep }));
    expect(calls).toHaveLength(2);
    expect(failure).toMatchObject({ status: 0, code: "NETWORK", message: "Check your connection and try again." });
  });

  it("ends a hung read at its deadline, with no retry left to run past it", async () => {
    const calls = serve("hang", json(200, { data: 1 }));
    const started = Date.now();
    const failure = await failureOf(apiRequest("/api/x", { deadlineMs: 60, sleep: recorder().sleep }));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls).toHaveLength(1);
    expect(failure).toMatchObject({ status: 0, code: "TIMEOUT" });
  });

  it("ends a read whose body stalls, too", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    serve(stalled);
    const failure = await failureOf(apiRequest("/api/x", { deadlineMs: 60, sleep: recorder().sleep }));
    expect(failure.code).toBe("TIMEOUT");
  });
});

describe("AUD-07 PS-13: rate limits", () => {
  it("waits out a short Retry-After once, then reads", async () => {
    const calls = serve(json(429, { error: { code: "RATE_LIMITED", message: "Slow down." } }, { "retry-after": "2" }), json(200, { data: "ok" }));
    const { pauses, sleep } = recorder();
    await expect(apiRequest("/api/x", { sleep })).resolves.toBe("ok");
    expect(calls).toHaveLength(2);
    expect(pauses).toEqual([2_000]);
  });

  it("does not retry when Retry-After is longer than the deadline allows, and says when to try", async () => {
    const calls = serve(json(429, {}, { "retry-after": "60" }));
    const { pauses, sleep } = recorder();
    const failure = await failureOf(apiRequest("/api/x", { sleep }));
    expect(calls).toHaveLength(1);
    expect(pauses).toEqual([]);
    expect(failure).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfterSeconds: 60, message: "Too many requests. Try again in 60 seconds." });
  });

  it("reads Retry-After as seconds or as a date", () => {
    const now = Date.parse("2026-09-27T10:00:00Z");
    expect(retryAfterSeconds("5", now)).toBe(5);
    expect(retryAfterSeconds("Sun, 27 Sep 2026 10:00:30 GMT", now)).toBe(30);
    expect(retryAfterSeconds("soon", now)).toBeUndefined();
    expect(retryAfterSeconds(null, now)).toBeUndefined();
  });
});

describe("AUD-07 PS-14: answers a retry cannot change", () => {
  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [422, "VALIDATION_ERROR"],
    [428, "PRECONDITION_REQUIRED"],
  ])("never retries a %i", async (status, code) => {
    const calls = serve(envelope(status, code, "no"), json(200, { data: 1 }));
    const failure = await failureOf(apiRequest("/api/x", { sleep: recorder().sleep }));
    expect(calls).toHaveLength(1);
    expect(failure).toMatchObject({ status, code });
  });

  it("maps a conflict to the module's conflict workflow and a refusal to refused", () => {
    expect(apiFailureOutcome({ status: 409, code: "CONFLICT", message: "", details: {}, fields: {}, detailCode: "TASK_VERSION_CONFLICT" })).toEqual({ kind: "conflict" });
    expect(apiFailureOutcome({ status: 403, code: "FORBIDDEN", message: "", details: {}, fields: {} })).toEqual({ kind: "refused" });
    expect(apiFailureOutcome({ status: 422, code: "VALIDATION_ERROR", message: "", details: {}, fields: {} })).toEqual({ kind: "invalid" });
  });
});

describe("AUD-07 PS-15: writes are sent once and never called rolled back", () => {
  it("never retries a write, even on a 5xx", async () => {
    const calls = serve(envelope(500, "INTERNAL_ERROR", "boom"), json(200, { data: 1 }));
    const failure = await failureOf(apiRequest("/api/x", { body: { a: 1 }, sleep: recorder().sleep }));
    expect(calls).toEqual([{ url: "/api/x", method: "POST" }]);
    // The application answered: its transaction rolled back, a definite failure.
    expect(apiFailureOutcome(failure)).toEqual({ kind: "failed" });
  });

  it("a write with no answer is unknown — not failed — and says to check before trying again", async () => {
    const calls = serve("network", json(200, { data: 1 }));
    const failure = await failureOf(apiRequest("/api/x", { method: "PATCH", body: {}, sleep: recorder().sleep }));
    expect(calls).toHaveLength(1);
    expect(failure).toMatchObject({ status: 0, code: "UNCONFIRMED", message: OUTCOME_COPY.unknown });
    expect(apiFailureOutcome(failure)).toEqual({ kind: "unknown" });
  });

  it("a write past its deadline is unknown, and is not replayed", async () => {
    const calls = serve("hang", json(200, { data: 1 }));
    const failure = await failureOf(apiRequest("/api/x", { body: {}, deadlineMs: 60, sleep: recorder().sleep }));
    expect(calls).toHaveLength(1);
    expect(apiFailureOutcome(failure)).toEqual({ kind: "unknown" });
  });

  it.each([502, 503, 504])("a gateway's bare %i on a write is unknown: the application never answered", async (status) => {
    serve(bare(status));
    const failure = await failureOf(apiRequest("/api/x", { method: "DELETE", sleep: recorder().sleep }));
    expect(failure.code).toBe("UNCONFIRMED");
    expect(apiFailureOutcome(failure)).toEqual({ kind: "unknown" });
  });

  it("the application's own 503 is definite: nothing was saved", async () => {
    serve(envelope(503, "TEMPORARILY_UNAVAILABLE", "The change could not be completed just now. Nothing was saved; try again."));
    const failure = await failureOf(apiRequest("/api/x", { body: {}, sleep: recorder().sleep }));
    expect(apiFailureOutcome(failure)).toEqual({ kind: "failed" });
  });

  it("a caller's own no-answer copy is kept (approvals reuse their idempotency key)", async () => {
    serve("network");
    const failure = await failureOf(apiRequest("/api/x", { body: {}, unconfirmedMessage: "It will not be recorded twice.", sleep: recorder().sleep }));
    expect(failure.message).toBe("It will not be recorded twice.");
  });
});

describe("AUD-07 PS-10: obsolete reads", () => {
  it("an aborted read ends as ABORTED, quietly", async () => {
    serve("hang");
    const controller = new AbortController();
    const pending = failureOf(apiRequest("/api/x", { signal: controller.signal, sleep: recorder().sleep }));
    controller.abort();
    const failure = await pending;
    expect(isAborted(failure)).toBe(true);
  });

  it("a slow old answer never replaces the newer one", async () => {
    const latest = new LatestRequest();
    let shown = "";
    let answerOld!: (value: string) => void;
    const old = latest.begin();
    const oldRead = new Promise<string>((resolve) => (answerOld = resolve)).then((value) => {
      if (old.current()) shown = value;
    });
    const fresh = latest.begin();
    expect(old.signal.aborted).toBe(true);
    await Promise.resolve("new").then((value) => {
      if (fresh.current()) shown = value;
    });
    answerOld("old");
    await oldRead;
    expect(shown).toBe("new");
    latest.cancel();
    expect(fresh.current()).toBe(false);
  });
});

describe("AUD-07: the module helpers keep their message rules", () => {
  it("engineering leads with the envelope's own sentence; daily logs with the first field's", async () => {
    const reply = () => envelope(422, "VALIDATION_ERROR", "Check the highlighted fields.", { title: ["Title is required."] });
    serve(reply());
    expect((await failureOf(engineeringApi("/api/x", { body: {} }))).message).toBe("Check the highlighted fields.");
    serve(reply());
    const daily = await failureOf(dailyLogApi("/api/x", { body: {} }));
    expect(daily.message).toBe("Title is required.");
    expect(daily.fields).toEqual({ title: "Title is required." });
  });
});
