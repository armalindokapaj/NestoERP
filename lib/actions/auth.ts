"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { auth, signIn, signOut } from "@/lib/auth";
import { SignInRateLimited } from "@/lib/auth/errors";
import { recordAuthEvent } from "@/lib/auth/events";
import { credentialsSchema } from "@/lib/auth/schema";
import { endOwnSession } from "@/lib/auth/session-store";
import { completePasswordReset, confirmRecoveryEmail, requestPasswordReset } from "@/lib/auth/password-recovery";
import { clientAddress, hitThrottle, userAgentOf } from "@/lib/core/security/throttle";
import { logger, serialiseError } from "@/lib/core/observability/logger";

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

/** End the cookie's own session regardless of workspace or membership health. */
export async function endSessionAction(): Promise<EndSessionResult> {
  let ok = true;
  try {
    const user = (await auth())?.user;
    if (user?.id && user.sessionId) {
      const ended = await endOwnSession({ sessionId: user.sessionId, userId: user.id });
      if (ended.ended) await recordAuthEvent({
        type: "LOGOUT", userId: user.id, companyId: ended.companyId, sessionId: user.sessionId,
      });
    }
  } catch (error) {
    ok = false;
    logger.error("auth.logout.failed", serialiseError(error));
  } finally {
    // Cookie removal must still run when the database is unavailable.
    try { await signOut({ redirect: false }); }
    catch (error) { ok = false; logger.error("auth.logout.cookie_failed", serialiseError(error)); }
  }
  return { ok };
}

export async function signOutAction(): Promise<void> {
  await endSessionAction();
  redirect("/login?reason=signed-out");
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
