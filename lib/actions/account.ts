"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { AccessError } from "@/lib/access/guards";
import { signOut } from "@/lib/auth";
import { requireUserContext } from "@/lib/context/current-user";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { changePasswordSchema, updateProfileSchema } from "@/lib/modules/account/account.schema";
import * as account from "@/lib/modules/account/account.service";

/**
 * Account basics (PRD #38 §20).
 *
 * Results carry codes, not sentences: the profile page translates them.
 */

export type AccountActionResult =
  | { ok: true; revokedSessions?: number }
  | { ok: false; code: string; fieldErrors?: Record<string, string> };

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
  console.error("[account] action failed", error);
  return { ok: false, code: "SAVE_FAILED" };
}

export async function updateProfileAction(input: {
  firstName: string;
  lastName: string;
  phone?: string;
}): Promise<AccountActionResult> {
  const context = await requireUserContext();
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION", fieldErrors: firstIssues(parsed.error.issues) };

  try {
    await account.updateProfile(context, parsed.data);
  } catch (error) {
    return failure(error);
  }
  // The name appears in the shell on every page.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<AccountActionResult> {
  const context = await requireUserContext();
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION", fieldErrors: firstIssues(parsed.error.issues) };

  const requestHeaders = await headers();
  try {
    const outcome = await account.changePassword(context, parsed.data, {
      ipAddress: clientAddress(requestHeaders),
      userAgent: userAgentOf(requestHeaders),
    });
    revalidatePath("/settings/profile");
    return { ok: true, revokedSessions: outcome.revokedSessions };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeSessionAction(sessionId: string): Promise<AccountActionResult> {
  const context = await requireUserContext();
  let current = false;
  try {
    ({ current } = await account.revokeOwnSession(context, sessionId));
  } catch (error) {
    return failure(error);
  }
  if (current) await signOut({ redirectTo: "/login" });
  revalidatePath("/settings/profile");
  return { ok: true, revokedSessions: 1 };
}

export async function revokeOtherSessionsAction(): Promise<AccountActionResult> {
  const context = await requireUserContext();
  const revoked = await account.revokeOtherSessions(context);
  revalidatePath("/settings/profile");
  return { ok: true, revokedSessions: revoked };
}

/** Signs out everywhere, this browser included, and lands on the sign-in page. */
export async function signOutEverywhereAction(): Promise<void> {
  const context = await requireUserContext();
  await account.revokeAllSessions(context);
  await signOut({ redirectTo: "/login" });
}
