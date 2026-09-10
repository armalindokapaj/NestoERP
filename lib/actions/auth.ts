"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/auth/events";
import { credentialsSchema, forgotPasswordSchema } from "@/lib/auth/schema";
import { requestPasswordReset, resetPassword } from "@/lib/auth/password-reset";
import { resetPasswordSchema } from "@/lib/auth/schema";
import { revokeSession } from "@/lib/auth/session-store";
import { resolveUserContext } from "@/lib/context/resolve-user-context";

export type SignInResult = { error: string } | undefined;

/**
 * Credentials sign-in (PRD #6 §6–§10).
 * Returns a single generic message on failure — the reason is never disclosed.
 */
export async function signInAction(input: {
  email: string;
  password: string;
  callbackUrl?: string;
}): Promise<SignInResult> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Incorrect email or password." };
  }

  // Only same-origin paths are accepted as a redirect target.
  const callbackUrl =
    input.callbackUrl && input.callbackUrl.startsWith("/") && !input.callbackUrl.startsWith("//")
      ? input.callbackUrl
      : "/dashboard";

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    // Re-thrown so Next.js can act on the NEXT_REDIRECT signal signIn raises.
    throw error;
  }
}

/**
 * Sign out (PRD #6 §53).
 *
 * The server-side session row is deleted first, so the session is genuinely
 * invalid rather than merely forgotten by this browser: any other tab holding
 * the same cookie fails on its next protected request (PRD #6 §54).
 */
export async function signOutAction(): Promise<void> {
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

  await signOut({ redirectTo: "/login" });
}

/**
 * Request a reset link (PRD #6 §55).
 *
 * The response is identical whether or not the address exists, so this action
 * cannot be used to discover which emails have accounts.
 */
export async function requestPasswordResetAction(email: string): Promise<{ ok: true }> {
  const parsed = forgotPasswordSchema.safeParse({ email });

  if (parsed.success) {
    await requestPasswordReset(parsed.data.email);
  }

  return { ok: true };
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: string; expired?: boolean };

/** Set a new password from a reset link (PRD #6 §56, §57). */
export async function resetPasswordAction(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please review the form and try again.",
    };
  }

  const result = await resetPassword(parsed.data.token, parsed.data.password);

  if (!result.ok) {
    return {
      ok: false,
      expired: true,
      error:
        result.reason === "EXPIRED"
          ? "That reset link has expired. Request a new one."
          : "That reset link is no longer valid. Request a new one.",
    };
  }

  return { ok: true };
}
