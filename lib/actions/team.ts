"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth";
import { AccessError } from "@/lib/access/guards";
import { requireUserContext } from "@/lib/context/current-user";
import { resolveUserContext } from "@/lib/context/resolve-user-context";
import { clientAddress, hitThrottle } from "@/lib/core/security/throttle";
import { ensurePersonForUser } from "@/lib/modules/hr/person.doors";
import * as departments from "@/lib/modules/team/departments/department.service";
import * as invitations from "@/lib/modules/team/invitations/invite.service";
import {
  acceptInviteSchema,
  createDepartmentSchema,
  inviteMemberSchema,
  updateDepartmentSchema,
  updateMemberSchema,
} from "@/lib/modules/team/team.schema";
import * as team from "@/lib/modules/team/team.service";

/**
 * Server actions for the Team module (PRD #14 §144).
 *
 * A thin shell over the same services the API routes call.
 */
function revalidateTeam(memberId?: string) {
  revalidatePath("/team", "layout");
  if (memberId) revalidatePath(`/team/${memberId}`, "layout");
  revalidatePath("/projects", "layout");
  revalidatePath("/dashboard");
}

export type TeamActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Invitation acceptance is throttled per token and per address (PRD #38 §17):
 * a token is unguessable, but a form that answers instantly forever is still
 * an oracle worth closing.
 */
async function acceptAllowed(token: string): Promise<TeamActionResult | null> {
  const allowance = await hitThrottle("INVITE_ACCEPT", {
    token,
    ip: clientAddress(await headers()),
  });
  return allowance.allowed
    ? null
    : { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
}

function toResult(error: unknown): TeamActionResult {
  if (error instanceof AccessError) return { ok: false, error: error.message };
  console.error("[team] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/* Members                                                                     */
/* -------------------------------------------------------------------------- */

export async function updateMemberAction(
  memberId: string,
  formData: FormData,
): Promise<TeamActionResult> {
  const context = await requireUserContext();

  const parsed = updateMemberSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await team.updateMember(context, memberId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateTeam(memberId);
  redirect(`/team/${memberId}`);
}

export async function memberStatusAction(
  memberId: string,
  action: "deactivate" | "reactivate" | "suspend" | "unsuspend",
): Promise<TeamActionResult> {
  const context = await requireUserContext();

  try {
    if (action === "deactivate") await team.deactivateMember(context, memberId);
    else if (action === "reactivate") await team.reactivateMember(context, memberId);
    else if (action === "suspend") await team.suspendMember(context, memberId);
    else await team.unsuspendMember(context, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateTeam(memberId);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

export type InviteActionResult =
  | { ok: true; delivered: boolean; email: string; inviteUrl?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function inviteMemberAction(formData: FormData): Promise<InviteActionResult> {
  const context = await requireUserContext();

  const parsed = inviteMemberSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const result = await invitations.inviteMember(context, parsed.data);
    revalidateTeam();
    return {
      ok: true,
      delivered: result.delivered,
      email: result.email,
      ...(result.inviteUrl ? { inviteUrl: result.inviteUrl } : {}),
    };
  } catch (error) {
    const failure = toResult(error);
    return failure as InviteActionResult;
  }
}

export async function resendInvitationAction(inviteId: string): Promise<InviteActionResult> {
  const context = await requireUserContext();

  try {
    const result = await invitations.resendInvitation(context, inviteId);
    revalidateTeam();
    return {
      ok: true,
      delivered: result.delivered,
      email: result.email,
      ...(result.inviteUrl ? { inviteUrl: result.inviteUrl } : {}),
    };
  } catch (error) {
    return toResult(error) as InviteActionResult;
  }
}

export async function cancelInvitationAction(inviteId: string): Promise<TeamActionResult> {
  const context = await requireUserContext();
  try {
    await invitations.cancelInvitation(context, inviteId);
  } catch (error) {
    return toResult(error);
  }
  revalidateTeam();
  return { ok: true };
}

/**
 * Accepts an invitation and signs the person in (PRD #14 §73, §77).
 *
 * Membership is activated in one transaction first; only then is a session
 * created, so a failed sign-in never leaves a consumed token without a member.
 */
export async function acceptInviteAction(formData: FormData): Promise<TeamActionResult> {
  const parsed = acceptInviteSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const refused = await acceptAllowed(parsed.data.token);
  if (refused) return refused;

  let email: string;
  try {
    // The address comes back from the acceptance itself: by this point the
    // token is consumed, so it can no longer be read from the invitation.
    ({ email } = await invitations.acceptInvite(parsed.data, { personDoor: ensurePersonForUser }));
  } catch (error) {
    return toResult(error);
  }

  // signIn raises NEXT_REDIRECT, which Next.js acts on — it must not be caught.
  await signIn("credentials", {
    email,
    password: parsed.data.password,
    redirectTo: "/dashboard",
  });

  return { ok: true };
}

/**
 * Accepts an invitation as the person who is already signed in (PRD #14 §75).
 *
 * The address on the invitation already has an account, so it is claimed by
 * proving control of that account rather than by choosing a new password. The
 * service compares the signed-in user against the invited address and refuses a
 * mismatch (PRD #14 §76).
 *
 * "Signed in" means the session row, not the cookie alone: a signed token keeps
 * its claims after the session behind it was revoked or its account disabled,
 * so the identity is resolved from the database the way every request is
 * (PRD #6 §79, PRD #47 §22).
 */
export async function acceptInviteAsCurrentUserAction(token: string): Promise<TeamActionResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: "This invitation is invalid or has expired." };
  }

  const resolved = await resolveUserContext();
  if (!resolved.ok) {
    return { ok: false, error: "Sign in to accept this invitation." };
  }
  const userId = resolved.context.userId;

  const refused = await acceptAllowed(token);
  if (refused) return refused;

  try {
    await invitations.acceptInvite({ token }, { authenticatedUserId: userId, personDoor: ensurePersonForUser });
  } catch (error) {
    return toResult(error);
  }

  revalidateTeam();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Departments                                                                 */
/* -------------------------------------------------------------------------- */

export async function createDepartmentAction(formData: FormData): Promise<TeamActionResult> {
  const context = await requireUserContext();

  const parsed = createDepartmentSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await departments.createDepartment(context, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateTeam();
  redirect("/team/departments");
}

export async function updateDepartmentAction(
  departmentId: string,
  formData: FormData,
): Promise<TeamActionResult> {
  const context = await requireUserContext();

  const parsed = updateDepartmentSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await departments.updateDepartment(context, departmentId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateTeam();
  redirect("/team/departments");
}

export async function departmentLifecycleAction(
  departmentId: string,
  action: "archive" | "restore",
): Promise<TeamActionResult> {
  const context = await requireUserContext();
  try {
    if (action === "archive") await departments.archiveDepartment(context, departmentId);
    else await departments.restoreDepartment(context, departmentId);
  } catch (error) {
    return toResult(error);
  }
  revalidateTeam();
  return { ok: true };
}
