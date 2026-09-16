import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request and correlation identity (PRD #32 §25-§34).
 *
 * `requestId` names one technical request — it comes back in a header so a user
 * reporting a problem can quote a reference that leads straight to the logs
 * (PRD #32 §28, §207). `correlationId` names one logical workflow, which may
 * span several requests and background jobs (PRD #32 §34).
 */

export type RequestContext = {
  requestId: string;
  correlationId: string;
  startedAt: number;
  route?: string;
  method?: string;
  companyId?: string;
  memberId?: string;
  /** Set when the work is a background job's, not a request's (PRD #51 §12-§14, §121). */
  jobKey?: string;
  workerId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const REQUEST_ID_HEADER = "x-request-id";
export const CORRELATION_ID_HEADER = "x-correlation-id";

function randomId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export function newRequestId(): string {
  return randomId("req");
}

export function newCorrelationId(): string {
  return randomId("corr");
}

/**
 * Reuses an inbound id only when it looks like one we issued. An arbitrary
 * client-supplied string would let a caller poison the log index (PRD #32 §26).
 */
export function resolveInboundId(value: string | null, prefix: string): string | null {
  if (!value) return null;
  return new RegExp(`^${prefix}_[a-f0-9]{24}$`).test(value) ? value : null;
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Attaches company and member once the user context has resolved. */
export function enrichRequestContext(fields: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}
