"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { requireUserContext } from "@/lib/context/current-user";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import * as compensation from "@/lib/modules/hr/compensation/compensation.service";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import {
  createAttendanceSchema,
  createCompensationSchema,
  createEmployeeProfileSchema,
  createLeaveSchema,
  employmentStatusSchema,
  leaveBalanceSchema,
  updateAttendanceSchema,
  updateEmployeeProfileSchema,
  updateLeaveSchema,
} from "@/lib/modules/hr/hr.schema";

/**
 * Server actions for the HR module (PRD #16 §182).
 *
 * A thin shell over the same services the API routes call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 */

export type HrActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function revalidateHr(memberId?: string) {
  revalidatePath("/hr", "layout");
  if (memberId) revalidatePath(`/hr/employees/${memberId}`, "layout");
  revalidatePath("/dashboard");
}

function toResult(error: unknown): HrActionResult {
  if (error instanceof AccessError) return { ok: false, error: error.message };
  console.error("[hr] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function invalid(error: { flatten(): { fieldErrors: unknown } }): HrActionResult {
  return {
    ok: false,
    error: "Please review the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/* Employment                                                                  */
/* -------------------------------------------------------------------------- */

export async function createEmployeeProfileAction(
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = createEmployeeProfileSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let memberId: string;
  try {
    memberId = (await employees.createEmployeeProfile(context, parsed.data)).memberId;
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  redirect(`/hr/employees/${memberId}`);
}

export async function updateEmployeeProfileAction(
  memberId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = updateEmployeeProfileSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await employees.updateEmployeeProfile(context, memberId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(memberId);
  redirect(`/hr/employees/${memberId}`);
}

export async function employmentStatusAction(
  memberId: string,
  input: { status: string; endDate?: string; note?: string },
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = employmentStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await employees.changeEmploymentStatus(context, memberId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(memberId);
  return { ok: true };
}

const rehireSchema = z.object({ startDate: z.coerce.date() });

export async function rehireAction(
  memberId: string,
  startDate: string,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = rehireSchema.safeParse({ startDate });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await employees.rehireEmployee(context, memberId, parsed.data.startDate);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(memberId);
  return { ok: true };
}

export async function progressAction(
  memberId: string,
  kind: "onboarding" | "offboarding",
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED",
): Promise<HrActionResult> {
  const context = await requireUserContext();

  try {
    await employees.setProgress(context, memberId, kind, status);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(memberId);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Compensation                                                                */
/* -------------------------------------------------------------------------- */

export async function recordCompensationAction(
  memberId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = createCompensationSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await compensation.recordCompensation(context, memberId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(memberId);
  redirect(`/hr/employees/${memberId}/compensation`);
}

/* -------------------------------------------------------------------------- */
/* Leave                                                                       */
/* -------------------------------------------------------------------------- */

export async function createLeaveAction(formData: FormData): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = createLeaveSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await leave.createLeave(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  redirect(`/hr/leave/${id}`);
}

export async function updateLeaveAction(
  leaveId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = updateLeaveSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await leave.updateLeave(context, leaveId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  redirect(`/hr/leave/${leaveId}`);
}

export type LeaveAction = "submit" | "approve" | "cancel";

export async function leaveLifecycleAction(
  leaveId: string,
  action: LeaveAction,
  note?: string,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  try {
    if (action === "submit") await leave.submitLeave(context, leaveId);
    else if (action === "approve") await leave.approveLeave(context, leaveId, note ?? null);
    else await leave.cancelLeave(context, leaveId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  return { ok: true };
}

export async function rejectLeaveAction(
  leaveId: string,
  reason: string,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  try {
    await leave.rejectLeave(context, leaveId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  return { ok: true };
}

export async function setLeaveBalanceAction(
  memberId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = leaveBalanceSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await leave.setLeaveBalance(context, memberId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(memberId);
  return { ok: true, message: "Leave balance saved." };
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

export async function createAttendanceAction(formData: FormData): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = createAttendanceSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await attendance.createAttendance(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  return { ok: true, id };
}

export async function updateAttendanceAction(
  attendanceId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireUserContext();

  const parsed = updateAttendanceSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await attendance.updateAttendance(context, attendanceId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  return { ok: true };
}
