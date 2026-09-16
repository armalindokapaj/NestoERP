import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AccessError, type ApiErrorCode, errorStatus } from "@/lib/access/guards";
import { recordAuthorizationDenial } from "@/lib/access/security-log";
import { resolveUserContext } from "@/lib/context/resolve-user-context";
import type { UserContext } from "@/lib/context/types";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  currentRequestContext,
  enrichRequestContext,
  newCorrelationId,
  newRequestId,
  runWithRequestContext,
} from "@/lib/core/observability/request-context";

/**
 * API response helpers (PRD #7 §150, §152).
 *
 * One error shape across the whole API, and one place that decides which status
 * a failure carries. Nothing internal reaches the client: no SQL, no stack
 * traces, no permission implementation details (PRD #7 §149).
 */
export function apiError(code: ApiErrorCode, message?: string, details?: unknown) {
  const requestId = currentRequestContext()?.requestId;
  return withRequestHeaders(
    NextResponse.json(
      {
        error: {
          code,
          message: message ?? new AccessError(code).message,
          // A user reporting a problem can quote this, and it leads straight to
          // the logs (PRD #32 §29, §207).
          ...(requestId ? { requestId } : {}),
          ...(details === undefined ? {} : { details }),
        },
      },
      { status: errorStatus(code) },
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
 */
export async function withContext(
  handler: (context: UserContext) => Promise<Response>,
): Promise<Response> {
  return runWithRequestContext(
    { requestId: newRequestId(), correlationId: newCorrelationId(), startedAt: Date.now() },
    () => handleRequest(handler),
  );
}

async function handleRequest(
  handler: (context: UserContext) => Promise<Response>,
): Promise<Response> {
  const result = await resolveUserContext();

  if (!result.ok) {
    if (result.reason === "UNAUTHENTICATED" || result.reason === "SESSION_EXPIRED") {
      recordAuthorizationDenial({ code: "UNAUTHENTICATED" });
      return apiError("UNAUTHENTICATED");
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

  try {
    return await handler(result.context);
  } catch (error) {
    if (error instanceof AccessError) {
      recordAuthorizationDenial({ code: error.code, reason: error.reason });
      return apiError(error.code, error.message, error.details);
    }

    if (error instanceof ZodError) {
      return apiError("VALIDATION_ERROR", undefined, error.flatten().fieldErrors);
    }

    // The full error reaches the logs; the caller gets a code and a reference
    // (PRD #32 §53, PRD #30 §150).
    logger.error("api.unhandled_error", serialiseError(error));
    return apiError("INTERNAL_ERROR");
  }
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
