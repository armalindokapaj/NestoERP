import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AccessError, type ApiErrorCode, errorStatus } from "@/lib/access/guards";
import { resolveUserContext } from "@/lib/context/resolve-user-context";
import type { UserContext } from "@/lib/context/types";

/**
 * API response helpers (PRD #7 §150, §152).
 *
 * One error shape across the whole API, and one place that decides which status
 * a failure carries. Nothing internal reaches the client: no SQL, no stack
 * traces, no permission implementation details (PRD #7 §149).
 */
export function apiError(code: ApiErrorCode, message?: string, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        code,
        message: message ?? new AccessError(code).message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status: errorStatus(code) },
  );
}

export function apiOk<T>(data: T, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200 });
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
  const result = await resolveUserContext();

  if (!result.ok) {
    if (result.reason === "UNAUTHENTICATED" || result.reason === "SESSION_EXPIRED") {
      return apiError("UNAUTHENTICATED");
    }
    // An inactive user, membership or company is authenticated but has no
    // workspace to act in.
    return apiError("FORBIDDEN", "Your workspace is unavailable.");
  }

  try {
    return await handler(result.context);
  } catch (error) {
    if (error instanceof AccessError) {
      return apiError(error.code, error.message, error.details);
    }

    if (error instanceof ZodError) {
      return apiError("VALIDATION_ERROR", undefined, error.flatten().fieldErrors);
    }

    console.error("[api] unhandled error", error);
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
