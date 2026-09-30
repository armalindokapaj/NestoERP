import { NextResponse } from "next/server";

import { AccessError, type ApiErrorCode, errorStatus } from "@/lib/access/guards";
import { recordAuthorizationDenial } from "@/lib/access/security-log";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { resolvePlatformContext, type PlatformContext } from "@/lib/context/platform-context";
import { runWithRequestScope } from "@/lib/core/observability/request-scope";
import { resolveUserContext, resolveUserContextIgnoringDevice } from "@/lib/context/resolve-user-context";
import type { ContextResult, UserContext } from "@/lib/context/types";
import { isStaleWorkspace, StaleWorkspaceError, TAB_WORKSPACE_HEADER } from "@/lib/context/tab-workspace";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { headers } from "next/headers";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  currentRequestContext,
  enrichRequestContext,
  newCorrelationId,
  newRequestId,
  runWithRequestContext,
} from "@/lib/core/observability/request-context";
import { verifiedRequestMethod } from "@/lib/core/security/request-method";
import { describeFailure } from "@/lib/api/failure";
import { detailsFieldErrors, errorCategory, type FieldErrors } from "@/lib/forms/errors";

/**
 * API response helpers (PRD #7 §150, §152).
 *
 * One error shape across the whole API, and one place that decides which status
 * a failure carries. Nothing internal reaches the client: no SQL, no stack
 * traces, no permission implementation details (PRD #7 §149).
 */
export function apiError(code: ApiErrorCode, message?: string, details?: unknown, fieldErrors?: FieldErrors) {
  const requestId = currentRequestContext()?.requestId;
  const text = message ?? new AccessError(code).message;
  const status = errorStatus(code);
  // AUD-09 §3: a refusal a form acts on also says which kind it is and which
  // fields it is about, keyed by canonical path. A permission, session or
  // not-found refusal keeps the bare envelope (PRD #47 §116, §224): its
  // category follows from its code alone (`errorCategory`), and a field list
  // there would only describe a record the caller may not see.
  const accessRefusal = status === 401 || status === 403 || status === 404;
  const businessCode = (details as { code?: unknown } | undefined)?.code;
  const fields = accessRefusal ? undefined : (fieldErrors ?? detailsFieldErrors(details, text));
  return withRequestHeaders(
    NextResponse.json(
      {
        error: {
          code,
          message: text,
          // A user reporting a problem can quote this, and it leads straight to
          // the logs (PRD #32 §29, §207).
          ...(requestId ? { requestId } : {}),
          ...(details === undefined ? {} : { details }),
          ...(accessRefusal ? {} : { category: errorCategory(code, typeof businessCode === "string" ? businessCode : undefined) }),
          ...(fields && Object.keys(fields).length ? { fieldErrors: fields } : {}),
        },
      },
      { status },
    ),
  );
}

export function apiOk<T>(data: T, init?: { status?: number }) {
  return withRequestHeaders(NextResponse.json(data, { status: init?.status ?? 200 }));
}

/** Every response carries its request id back (PRD #32 §28, §358). */
function withRequestHeaders(response: Response): Response {
  const context = currentRequestContext();
  if (context) {
    response.headers.set(REQUEST_ID_HEADER, context.requestId);
    response.headers.set(CORRELATION_ID_HEADER, context.correlationId);
  }
  return response;
}

/**
 * Wraps a route handler with the standard guard sequence: authenticate →
 * resolve context → run → translate failures (PRD #7 §66).
 *
 * Every protected endpoint goes through here, so no handler can forget the
 * authentication step.
 *
 * Each call gets its own request scope (NAV-02 CTX-02): the context, the
 * person's organization access and their group's company contexts are read
 * once for this request and shared by every service it calls — and by nothing
 * after it.
 */
export async function withContext(
  handler: (context: UserContext) => Promise<Response>,
  options: WithContextOptions = {},
): Promise<Response> {
  return runWithRequestContext(
    { requestId: newRequestId(), correlationId: newCorrelationId(), startedAt: Date.now() },
    () => runWithRequestScope(() => handleRequest(handler, options)),
  );
}

/**
 * What an endpoint does while the Group workspace is active (Workspace Context
 * §14, §85, §105). The default is nothing: an endpoint reads and writes one
 * company's records, and in the Group workspace the session's company is only
 * where the person is anchored, so answering would put one company's data under
 * a group header. An endpoint says what it does there, in the route file:
 *
 * - `read`  — a GET whose answer is the union of the companies the person may
 *             read, or a read that does not depend on a company at all;
 * - `any`   — the person's own affairs (notifications, their account), which
 *             have no company to get wrong.
 */
export type WithContextOptions = {
  group?: "read" | "any";
  /**
   * `ignore` is for the endpoints an app with a revoked or out-of-date device
   * must still reach to be told so (MOB-11 §20, §139). Everything else keeps the
   * default, which refuses such a device.
   */
  device?: "enforce" | "ignore";
};

async function handleRequest(
  handler: (context: UserContext) => Promise<Response>,
  options: WithContextOptions,
): Promise<Response> {
  // The enforcement read, fresh for this request, beside authentication
  // (NAV-02 PAR-01, MAINT-01). Authentication decides first; the maintenance
  // promise is observed at once so a failure while it waits is never unhandled.
  const maintenanceRead = getMaintenanceState();
  maintenanceRead.catch(() => undefined);

  // Reads that fail before the handler runs get the same sanitized envelope as
  // the handler's own failures (MAINT-03, V05).
  let result: ContextResult;
  try {
    result = options.device === "ignore" ? await resolveUserContextIgnoringDevice() : await resolveUserContext();
  } catch (error) {
    return translateError(error);
  }

  if (!result.ok) {
    if (result.reason === "UNAUTHENTICATED" || result.reason === "SESSION_EXPIRED") {
      recordAuthorizationDenial({ code: "UNAUTHENTICATED" });
      return apiError("UNAUTHENTICATED");
    }
    // The installed app, not the person: revoked or blocked, or too old (MOB-11 §139, §164).
    if (result.reason === "DEVICE_REVOKED" || result.reason === "DEVICE_BLOCKED") {
      recordAuthorizationDenial({ code: "FORBIDDEN", reason: "PERMISSION_DENIED" });
      return apiError("DEVICE_REVOKED", undefined, { reason: result.reason === "DEVICE_REVOKED" ? "REVOKED" : "BLOCKED" });
    }
    if (result.reason === "UPDATE_REQUIRED") {
      recordAuthorizationDenial({ code: "FORBIDDEN", reason: "PERMISSION_DENIED" });
      return apiError("UPDATE_REQUIRED");
    }
    // A Platform Admin is authenticated but is nobody inside any company: a
    // business endpoint is simply not theirs (E-06 §116).
    if (result.reason === "PLATFORM_SESSION") {
      recordAuthorizationDenial({ code: "FORBIDDEN", reason: "PERMISSION_DENIED" });
      return apiError("FORBIDDEN");
    }
    // An inactive user, membership or company is authenticated but has no
    // workspace to act in. The code says which, since it is the caller's own
    // state and discloses nothing about anybody else (PRD #47 §22, §23, §225).
    const code = result.reason === "COMPANY_UNAVAILABLE" ? "COMPANY_INACTIVE" : "MEMBERSHIP_INACTIVE";
    recordAuthorizationDenial({ code });
    return apiError(code);
  }

  // Diagnostic identity, never anything the caller could not already see.
  enrichRequestContext({
    companyId: result.context.companyId,
    memberId: result.context.membershipId,
  });

  let maintenance: Awaited<typeof maintenanceRead>;
  try {
    maintenance = await maintenanceRead;
  } catch (error) {
    // Unable to read the policy, which is not the policy refusing: the logs say which (MAINT-03).
    logger.error("api.maintenance_unreadable", serialiseError(error));
    return apiError("INTERNAL_ERROR");
  }
  // Direct route invocation in the security matrix has no Next request store.
  // It still exercises authorization; live HTTP requests provide these values.
  let requestHeaders: Pick<Headers, "get"> = new Headers();
  let live = false;
  try {
    requestHeaders = await headers();
    live = true;
  } catch {
    // Next throws synchronously when a route is invoked without its request store.
  }
  const requestPath = requestHeaders.get("x-nesto-request-path") ?? "";
  // Believed only when middleware signed it; unverified reads as a write (AUD-06).
  const method = live ? await verifiedRequestMethod(requestHeaders, requestPath) : "GET";
  if (result.context.workspace.scopeType === "GROUP") {
    const reads = ["GET", "HEAD", "OPTIONS"].includes(method);
    if (options.group !== "any" && !(options.group === "read" && reads)) {
      recordAuthorizationDenial({ code: "WORKSPACE_COMPANY_REQUIRED", reason: "SCOPE_DENIED" });
      return apiError("WORKSPACE_COMPANY_REQUIRED");
    }
  }
  // A write from a tab still showing another workspace (AUD-03 §7). The
  // person's own affairs (`any`) have no company to get wrong.
  if (options.group !== "any" && !["GET", "HEAD", "OPTIONS"].includes(method) && isStaleWorkspace(result.context, requestHeaders.get(TAB_WORKSPACE_HEADER))) {
    recordAuthorizationDenial({ code: "CONFLICT", reason: "STALE_WORKSPACE" });
    return apiError("CONFLICT", "Your workspace changed in another tab, so nothing was saved.", { code: "WORKSPACE_CHANGED" });
  }
  if (maintenance.enabled) return apiError("COMPANY_INACTIVE", "NESTO is temporarily unavailable for maintenance.");
  if (maintenance.readOnly && !["GET", "HEAD", "OPTIONS"].includes(method)) return apiError("CONFLICT", "NESTO is currently in read-only mode.");
  if (maintenance.disableUploads && !["GET", "HEAD", "OPTIONS"].includes(method) && /upload|document-version/.test(requestPath)) return apiError("CONFLICT", "Uploads are temporarily disabled.");

  try {
    return await handler(result.context);
  } catch (error) {
    return translateError(error);
  }
}

/**
 * A thrown failure as the envelope (AUD-09 §3): read once by
 * `describeFailure`, which the server actions answer from too, so both
 * transports carry the same code, category and field errors. A database
 * uniqueness violation is a safe business conflict naming the field; an
 * unexpected error reaches the logs and the caller gets a code and a reference.
 */
function translateError(error: unknown): Response {
  if (error instanceof AccessError) {
    recordAuthorizationDenial({ code: error.code, reason: error.reason });
  }
  if (error instanceof StaleWorkspaceError) {
    recordAuthorizationDenial({ code: "CONFLICT", reason: "STALE_WORKSPACE" });
  }

  const failure = describeFailure(error);
  if (!failure.expected) {
    // The full error reaches the logs; the caller gets a code and a reference
    // (PRD #32 §53, PRD #30 §150).
    logger.error("api.unhandled_error", serialiseError(error));
    return apiError("INTERNAL_ERROR");
  }
  // A stale edit, a record already decided, a transition that no longer
  // applies, a value already taken: the rate of these says whether two people
  // are routinely working on the same thing (PRD #48 §181).
  if (failure.code === "CONFLICT" && !(error instanceof StaleWorkspaceError)) {
    incrementCounter(Metric.CONFLICT, { kind: failure.businessCode ?? "unspecified" });
  }
  return apiError(failure.code, failure.message, failure.details, failure.fieldErrors);
}

/**
 * The platform's own guard sequence (E-06 §116): a platform session and active
 * platform access, or nothing. A company session — an Owner's included — is
 * refused here exactly as a Platform Admin is refused by `withContext`.
 */
export async function withPlatformContext(
  handler: (context: PlatformContext) => Promise<Response>,
): Promise<Response> {
  return runWithRequestContext(
    { requestId: newRequestId(), correlationId: newCorrelationId(), startedAt: Date.now() },
    () => runWithRequestScope(async () => {
      // A valid tenant context can be rejected before resolving the separate
      // Platform Admin session. This also keeps direct route security sweeps
      // on the same fail-closed boundary as live requests.
      const tenantResult = await resolveUserContext();
      if (tenantResult.ok) {
        recordAuthorizationDenial({ code: "FORBIDDEN", reason: "PERMISSION_DENIED" });
        return apiError("FORBIDDEN");
      }
      const result = await resolvePlatformContext();
      if (!result.ok) {
        if (result.reason === "UNAUTHENTICATED" || result.reason === "SESSION_EXPIRED") {
          recordAuthorizationDenial({ code: "UNAUTHENTICATED" });
          return apiError("UNAUTHENTICATED");
        }
        recordAuthorizationDenial({ code: "FORBIDDEN", reason: "PERMISSION_DENIED" });
        return apiError("FORBIDDEN");
      }
      try {
        return await handler(result.context);
      } catch (error) {
        return translateError(error);
      }
    }),
  );
}

/** Reads and parses a JSON body, refusing anything that is not an object. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new AccessError("VALIDATION_ERROR", "Expected a JSON object body.");
}

/** `readJson` for requests whose body is optional: no body at all reads as `{}`. */
export async function readOptionalJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  return readJson(new Request(request.url, { method: "POST", body: text }));
}

/**
 * `{ data, meta: { contextKey } }` for answers the shell's controllers keep
 * (NAV-03 RUNTIME-02, §12): the key is the shell's own, over the same
 * request-scoped contexts, so a browser can drop an answer drawn for another
 * identity or workspace. It is never read back as authority.
 */
export async function withMeta<T>(context: UserContext, data: Promise<T>): Promise<{ data: T; meta: { contextKey: string } }> {
  const { shellContextKey } = await import("@/lib/workspace/shell-core");
  const [value, contextKey] = await Promise.all([data, shellContextKey(context)]);
  return { data: value, meta: { contextKey } };
}
