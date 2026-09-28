"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { endSessionAction } from "@/lib/actions/auth";
import { resolvePlatformContext, type PlatformContext } from "@/lib/context/platform-context";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { changePasswordSchema } from "@/lib/modules/account/account.schema";
import * as platformAccount from "@/lib/modules/platform/platform-account.service";
import type { AccountActionResult } from "./account";

/** My Account & Security in the Platform console (ADM-01). Same result shape as the tenant account actions. */

const PATH = "/admin/account";

/**
 * The platform caller, or null. An action refuses a tenant session with an
 * answer, as company actions do, rather than a page's redirect to its home.
 */
async function platformCaller(): Promise<PlatformContext | null> {
  const result = await resolvePlatformContext();
  return result.ok ? result.context : null;
}

const REFUSED: AccountActionResult = { ok: false, code: "FORBIDDEN" };

function firstIssues(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

function failure(error: unknown): AccountActionResult {
  if (error instanceof AccessError) return { ok: false, code: error.message };
  console.error("[platform-account] action failed", error);
  return { ok: false, code: "SAVE_FAILED" };
}

export async function changePlatformPasswordAction(input: { currentPassword: string; newPassword: string; confirmPassword: string }): Promise<AccountActionResult> {
  const context = await platformCaller();
  if (!context) return REFUSED;
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION", fieldErrors: firstIssues(parsed.error.issues) };
  const requestHeaders = await headers();
  try {
    const outcome = await platformAccount.changePlatformPassword(context, parsed.data, { ipAddress: clientAddress(requestHeaders), userAgent: userAgentOf(requestHeaders) });
    revalidatePath(PATH);
    return { ok: true, revokedSessions: outcome.revokedSessions };
  } catch (error) {
    return failure(error);
  }
}

const recoveryEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("EMAIL_INVALID").max(254, "EMAIL_INVALID"),
  currentPassword: z.string().min(1, "CURRENT_PASSWORD_REQUIRED").max(200, "PASSWORD_TOO_LONG"),
});

export async function startRecoveryEmailAction(input: { email: string; currentPassword: string }): Promise<AccountActionResult> {
  const context = await platformCaller();
  if (!context) return REFUSED;
  const parsed = recoveryEmailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION", fieldErrors: firstIssues(parsed.error.issues) };
  try {
    const outcome = await platformAccount.startPlatformRecoveryEmail(context, parsed.data);
    if (!outcome.ok) return { ok: false, code: outcome.code, fieldErrors: outcome.code === "CURRENT_PASSWORD_INCORRECT" ? { currentPassword: outcome.code } : { email: outcome.code } };
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function revokePlatformSessionAction(sessionId: string): Promise<AccountActionResult> {
  const context = await platformCaller();
  if (!context) return REFUSED;
  let current = false;
  try {
    ({ current } = await platformAccount.revokePlatformOwnSession(context, sessionId));
  } catch (error) {
    return failure(error);
  }
  if (current) await endSessionAction();
  revalidatePath(PATH);
  return { ok: true, revokedSessions: 1 };
}

export async function revokePlatformOtherSessionsAction(): Promise<AccountActionResult> {
  const context = await platformCaller();
  if (!context) return REFUSED;
  const revoked = await platformAccount.revokePlatformOtherSessions(context);
  revalidatePath(PATH);
  return { ok: true, revokedSessions: revoked };
}

export async function signOutPlatformEverywhereAction(): Promise<void> {
  const context = await platformCaller();
  if (!context) redirect("/access-denied");
  await platformAccount.revokePlatformAllSessions(context);
  await endSessionAction();
}
