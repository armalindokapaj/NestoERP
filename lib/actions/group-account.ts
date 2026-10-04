"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { resolveGroupContext } from "@/lib/context/group-context";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { changePasswordSchema } from "@/lib/modules/account/account.schema";
import * as platformAccount from "@/lib/modules/platform/platform-account.service";
import type { AccountActionResult } from "./account";

/** My account for a person who belongs to a group and to no company (Admin PRD #9). Same result shape as the other account actions. */

const PATH = "/group/account";

export async function changeGroupPasswordAction(input: { currentPassword: string; newPassword: string; confirmPassword: string }): Promise<AccountActionResult> {
  const result = await resolveGroupContext();
  if (!result.ok) return { ok: false, code: "FORBIDDEN" };
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues as Array<z.core.$ZodIssue>) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, code: "VALIDATION", fieldErrors };
  }
  const requestHeaders = await headers();
  try {
    const outcome = await platformAccount.changePlatformPassword(result.context, parsed.data, { ipAddress: clientAddress(requestHeaders), userAgent: userAgentOf(requestHeaders) });
    revalidatePath(PATH);
    return { ok: true, revokedSessions: outcome.revokedSessions };
  } catch (error) {
    if (error instanceof AccessError) return { ok: false, code: error.message };
    console.error("[group-account] action failed", error);
    return { ok: false, code: "SAVE_FAILED" };
  }
}
