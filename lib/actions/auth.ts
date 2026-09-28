"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { signIn, signOut } from "@/lib/auth";
import { SignInRateLimited } from "@/lib/auth/errors";
import { recordAuthEvent } from "@/lib/auth/events";
import { credentialsSchema } from "@/lib/auth/schema";
import { revokeSession } from "@/lib/auth/session-store";
import { completePasswordReset, confirmRecoveryEmail, requestPasswordReset } from "@/lib/auth/password-recovery";
import { clientAddress, hitThrottle, userAgentOf } from "@/lib/core/security/throttle";
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


/* -------------------------------------------------------------------------- */
/* Password recovery (ADM-01)                                                  */
/* -------------------------------------------------------------------------- */

const recoveryIdentifier = z.string().trim().min(1).max(254);
const resetSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(10, "Use at least 10 characters").max(200, "That password is too long"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((values) => values.password === values.confirmPassword, { message: "Both passwords must match", path: ["confirmPassword"] });

/**
 * Asks for a reset link. The answer is the same whether or not the account
 * exists, has a verified recovery address, or was throttled — and the lookup
 * and sending happen after the response, so its timing says nothing either.
 */
export async function requestPasswordResetAction(identifier: string): Promise<{ ok: true }> {
  const parsed = recoveryIdentifier.safeParse(identifier);
  if (!parsed.success) return { ok: true };
  const requestHeaders = await headers();
  const ipAddress = clientAddress(requestHeaders);
  const userAgent = userAgentOf(requestHeaders);
  const allowance = await hitThrottle("AUTH_RESET_REQUEST", { account: parsed.data.toLowerCase(), ip: ipAddress });
  if (!allowance.allowed) return { ok: true };
  after(async () => {
    try {
      await requestPasswordReset(parsed.data, { ipAddress, userAgent });
    } catch (error) {
      logger.error("auth.reset_request_failed", { error: serialiseError(error) });
    }
  });
  return { ok: true };
}

export type ResetPasswordResult = { ok: true } | { ok: false; error: string; expired?: boolean };

/** Sets a new password from a reset link. Never signs the person in. */
export async function resetPasswordAction(input: { token: string; password: string; confirmPassword: string }): Promise<ResetPasswordResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please review the form and try again." };
  const requestHeaders = await headers();
  const meta = { ipAddress: clientAddress(requestHeaders), userAgent: userAgentOf(requestHeaders) };
  const allowance = await hitThrottle("AUTH_RESET_SUBMIT", { token: parsed.data.token, ip: meta.ipAddress });
  if (!allowance.allowed) return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
  const result = await completePasswordReset(parsed.data.token, parsed.data.password, meta);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    expired: true,
    error: result.reason === "EXPIRED" ? "That reset link has expired. Request a new one." : "That reset link is no longer valid. Request a new one.",
  };
}

/** Confirms a recovery address from its emailed link — on a button press, so a link preview cannot spend it. */
export async function confirmRecoveryEmailAction(token: string): Promise<{ ok: true } | { ok: false; reason: "EXPIRED" | "INVALID" | "RATE_LIMITED" }> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return { ok: false, reason: "INVALID" };
  const requestHeaders = await headers();
  const meta = { ipAddress: clientAddress(requestHeaders), userAgent: userAgentOf(requestHeaders) };
  const allowance = await hitThrottle("AUTH_RESET_SUBMIT", { token, ip: meta.ipAddress });
  if (!allowance.allowed) return { ok: false, reason: "RATE_LIMITED" };
  const result = await confirmRecoveryEmail(token, meta);
  if (result.ok) return { ok: true };
  return { ok: false, reason: result.reason === "VALID" ? "INVALID" : result.reason };
}
