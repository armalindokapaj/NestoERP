"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/lib/auth";
import { SignInRateLimited } from "@/lib/auth/errors";
import { recordAuthEvent } from "@/lib/auth/events";
import { credentialsSchema } from "@/lib/auth/schema";
import { revokeSession } from "@/lib/auth/session-store";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { resolveUserContext } from "@/lib/context/resolve-user-context";

export type SignInResult = { error: string } | undefined;

/**
 * Credentials sign-in (PRD #6 §6–§10).
 * Returns a single generic message on failure — the reason is never disclosed.
 */
export async function signInAction(input: {
  username: string;
  password: string;
  callbackUrl?: string;
}): Promise<SignInResult> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Incorrect username or password." };
  }

  // Only same-origin paths are accepted as a redirect target.
  const callbackUrl =
    input.callbackUrl && input.callbackUrl.startsWith("/") && !input.callbackUrl.startsWith("//")
      ? input.callbackUrl
      : "/dashboard";

  try {
    await signIn("credentials", {
      username: parsed.data.username,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    // Too many recent failures: waiting is the fix, so say so (PRD #38 §17).
    if (error instanceof SignInRateLimited || (error instanceof AuthError && readCode(error) === "rate_limited")) {
      return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
    }
    if (error instanceof AuthError) {
      return { error: "Incorrect username or password." };
    }
    // Re-thrown so Next.js can act on the NEXT_REDIRECT signal signIn raises.
    throw error;
  }
}

function readCode(error: AuthError): string | undefined {
  const code = (error as AuthError & { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export type EndSessionResult = { ok: true } | { ok: false };

/**
 * Sign out (PRD #6 §53) without leaving the page: the caller decides where to go.
 *
 * The server-side session row is deleted first, so the session is genuinely
 * invalid rather than merely forgotten by this browser: any other tab holding
 * the same cookie fails on its next protected request (PRD #6 §54). The top-bar
 * menu uses this so it can report a failure, and so the way to sign-in is a
 * full load that carries nothing of this user along (Profile Menu §39, §42, §44).
 */
export async function endSessionAction(): Promise<EndSessionResult> {
  try {
    const result = await resolveUserContext();

    if (result.ok) {
      await revokeSession(result.context.sessionId);
      await recordAuthEvent({
        type: "LOGOUT",
        userId: result.context.userId,
        companyId: result.context.companyId,
        sessionId: result.context.sessionId,
      });
    }

    await signOut({ redirect: false });
    return { ok: true };
  } catch (error) {
    // Reported as a failure the menu can say plainly and let the person retry.
    logger.error("auth.logout.failed", serialiseError(error));
    return { ok: false };
  }
}

/** Sign out and land on sign-in, for pages without the application shell. */
export async function signOutAction(): Promise<void> {
  const result = await endSessionAction();
  if (!result.ok) throw new Error("Sign-out failed.");
  redirect("/login");
}

