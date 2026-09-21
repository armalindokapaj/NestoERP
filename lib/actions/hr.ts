"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireCompanyContext } from "@/lib/context/current-user";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import * as compensation from "@/lib/modules/hr/compensation/compensation.service";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import type { ProbableDuplicate } from "@/lib/modules/hr/employees/employee.service";
import { applyEmploymentChange, cancelScheduledChange } from "@/lib/modules/hr/employment/employment.change.service";
import { correctEmploymentHistory } from "@/lib/modules/hr/employment/employment.correction.service";
import { cancelScheduledChangeSchema, correctionSchema, employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import type { EmploymentChangeResultDTO } from "@/lib/modules/hr/employment/employment.types";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { endWorkforce } from "@/lib/modules/workforce/workforce.end";
import {
  createAttendanceSchema,
  createCompensationSchema,
  createEmployeeProfileSchema,
  createLeaveSchema,
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
  | { ok: false; error: string; fieldErrors?: Record<string, string[]>; duplicates?: ProbableDuplicate[] };

function revalidateHr(employeeId?: string) {
  revalidatePath("/hr", "layout");
  if (employeeId) revalidatePath(`/hr/employees/${employeeId}`, "layout");
  revalidatePath("/workforce", "layout");
  revalidatePath("/dashboard");
}

function toResult(error: unknown): HrActionResult {
  if (error instanceof AccessError) {
    // The people a new employee might already be, for HR to choose from (E-04 §92, §176).
    const details = error.details as { code?: string; candidates?: ProbableDuplicate[] } | undefined;
    if (details?.code === "PROBABLE_DUPLICATE") return { ok: false, error: error.message, duplicates: details.candidates ?? [] };
    return { ok: false, error: error.message };
  }
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
  const context = await requireCompanyContext();

  const parsed = createEmployeeProfileSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let employeeId: string;
  try {
    employeeId = (await employees.createEmployeeProfile(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  revalidatePath("/people", "layout");
  redirect(`/hr/employees/${employeeId}`);
}

export async function updateEmployeeProfileAction(
  employeeId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateEmployeeProfileSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await employees.updateEmployeeProfile(context, employeeId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(employeeId);
  redirect(`/hr/employees/${employeeId}`);
}

/**
 * One dated employment change — promotion, transfer, manager, location, type,
 * status, ending, rehire (E-03 §36, §74). The organization's placement door is
 * passed in, so a department's team follows the move (ADR 0004), and the
 * workforce's end door, so crews and project assignments end with the
 * employment (E-04 §105, ADR 0006).
 */
export async function employmentChangeAction(employeeId: string, input: unknown): Promise<HrActionResult & { outcome?: EmploymentChangeResultDTO }> {
  const context = await requireCompanyContext();

  const parsed = employmentChangeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  let outcome: EmploymentChangeResultDTO;
  try {
    outcome = await applyEmploymentChange(context, employeeId, parsed.data, { placement: placeMembership, workforce: endWorkforce });
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(employeeId);
  revalidatePath("/people", "layout");
  return {
    ok: true,
    outcome,
    message: outcome.outcome === "SCHEDULED" ? "Scheduled." : outcome.needsAccountIn ? `Transferred. ${outcome.needsAccountIn.companyName} has no NESTO login for them yet.` : "Saved.",
  };
}

export async function cancelScheduledChangeAction(employeeId: string, changeId: string, reason?: string): Promise<HrActionResult> {
  const context = await requireCompanyContext();
  const parsed = cancelScheduledChangeSchema.safeParse({ reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await cancelScheduledChange(context, employeeId, changeId, parsed.data.reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(employeeId);
  return { ok: true };
}

/** A correction of one history row, with its reason (E-03 §42-§44, §76, §224). */
export async function correctEmploymentHistoryAction(employeeId: string, input: unknown): Promise<HrActionResult> {
  const context = await requireCompanyContext();

  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await correctEmploymentHistory(context, employeeId, parsed.data, { placement: placeMembership });
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(employeeId);
  revalidatePath("/people", "layout");
  return { ok: true };
}

export async function progressAction(
  employeeId: string,
  kind: "onboarding" | "offboarding",
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED",
): Promise<HrActionResult> {
  const context = await requireCompanyContext();

  try {
    await employees.setProgress(context, employeeId, kind, status);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(employeeId);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Compensation                                                                */
/* -------------------------------------------------------------------------- */

export async function recordCompensationAction(
  employeeId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireCompanyContext();

  const parsed = createCompensationSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await compensation.recordCompensation(context, employeeId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(employeeId);
  redirect(`/hr/employees/${employeeId}/compensation`);
}

/* -------------------------------------------------------------------------- */
/* Leave                                                                       */
/* -------------------------------------------------------------------------- */

export async function createLeaveAction(formData: FormData): Promise<HrActionResult> {
  const context = await requireCompanyContext();

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
  const context = await requireCompanyContext();

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
  const context = await requireCompanyContext();

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
  const context = await requireCompanyContext();

  try {
    await leave.rejectLeave(context, leaveId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr();
  return { ok: true };
}

export async function setLeaveBalanceAction(
  employeeId: string,
  formData: FormData,
): Promise<HrActionResult> {
  const context = await requireCompanyContext();

  const parsed = leaveBalanceSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await leave.setLeaveBalance(context, employeeId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHr(employeeId);
  return { ok: true, message: "Leave balance saved." };
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

export async function createAttendanceAction(formData: FormData): Promise<HrActionResult> {
  const context = await requireCompanyContext();

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
  const context = await requireCompanyContext();

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
