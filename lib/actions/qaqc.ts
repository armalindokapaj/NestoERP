"use server";

import { revalidatePath } from "next/cache";

import type { ZodError } from "zod";

import { actionFailure, validationFailure } from "@/lib/actions/result";
import { approvalGuardFrom, type PendingCycle } from "@/lib/core/approvals/approval-guard";
import { requireCompanyContext } from "@/lib/context/current-user";
import { committed } from "@/lib/forms/committed";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import * as materials from "@/lib/modules/qaqc/materials/material.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import * as templates from "@/lib/modules/qaqc/templates/template.service";
import {
  checklistSchema,
  correctiveActionSchema,
  defectSchema,
  escalateSchema,
  inspectionSchema,
  materialDecisionSchema,
  ncrSchema,
  reinspectionSchema,
  requestSchema,
  submitInspectionSchema,
  templateSchema,
} from "@/lib/modules/qaqc/qaqc.schema";

/**
 * Server actions for the QA/QC module (PRD #21 §233).
 *
 * A thin shell over the same services the pages call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 */

/**
 * An editor's action answers where the saved record lives instead of
 * redirecting, so the form can tell the save committed (AUD-03 §6).
 */
export type QaqcActionResult =
  | { ok: true; id?: string; message?: string; redirectTo?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

function revalidateQaqc(recordPath?: string) {
  revalidatePath("/qaqc", "layout");
  if (recordPath) revalidatePath(recordPath, "layout");
  revalidatePath("/dashboard");
}

/** One reading of a failure for both transports (AUD-09 §3, §6). */
function toResult(error: unknown): QaqcActionResult {
  return actionFailure(error, "qaqc");
}

/** Every issue under its full path (AUD-09 §3, FV-04). */
function invalid(error: ZodError): QaqcActionResult {
  return validationFailure(error);
}

/**
 * Reads a form that carries repeated line fields.
 *
 * Rows arrive as `items[0][label]` and so on, because an HTML form has no
 * nested objects and a JSON blob in a hidden field is a thing nobody can debug
 * from the network tab.
 */
function formValues(
  formData: FormData,
  rowKey = "items",
): { values: Record<string, unknown>; rows: Record<string, string>[] } {
  const values: Record<string, unknown> = {};
  const collected = new Map<number, Record<string, string>>();
  const pattern = new RegExp(`^${rowKey}\\[(\\d+)\\]\\[(\\w+)\\]$`);

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;

    const match = pattern.exec(key);
    if (match) {
      const index = Number.parseInt(match[1]!, 10);
      const row = collected.get(index) ?? {};
      row[match[2]!] = value;
      collected.set(index, row);
      continue;
    }

    values[key] = value;
  }

  const rows = [...collected.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
  return { values, rows };
}

/** A checkbox posts "on" when ticked and nothing at all when not. */
function checked(value: string | undefined): boolean {
  return value === "on" || value === "true";
}

/* -------------------------------------------------------------------------- */
/* Inspection requests                                                         */
/* -------------------------------------------------------------------------- */

export async function createRequestAction(formData: FormData): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = requestSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await requests.createRequest(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/requests/${id}`);
}

export async function updateRequestAction(
  requestId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = requestSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await requests.updateRequest(context, requestId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/requests/${requestId}`);
  return committed(`/qaqc/requests/${requestId}`);
}

export async function assignRequestAction(
  requestId: string,
  memberId: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await requests.assignRequest(context, requestId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/requests/${requestId}`);
  return { ok: true, message: "Inspector assigned." };
}

export async function cancelRequestAction(
  requestId: string,
  reason: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await requests.cancelRequest(context, requestId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/requests/${requestId}`);
  return { ok: true, message: "Request cancelled." };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

function templateInput(formData: FormData) {
  const { values, rows } = formValues(formData);

  return {
    ...values,
    items: rows
      .filter((row) => (row.label ?? "").trim() !== "")
      .map((row) => ({
        ...row,
        required: checked(row.required),
        requiresEvidenceOnFail: checked(row.requiresEvidenceOnFail),
      })),
  };
}

export async function createTemplateAction(formData: FormData): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = templateSchema.safeParse(templateInput(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await templates.createTemplate(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/templates/${id}`);
}

export async function updateTemplateAction(
  templateId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = templateSchema.safeParse(templateInput(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    // Saving a template that has been used creates a new version, so the id
    // that comes back may not be the one that went in (PRD #21 §53).
    id = (await templates.updateTemplate(context, templateId, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/templates/${templateId}`);
  return committed(`/qaqc/templates/${id}`);
}

export async function templateLifecycleAction(
  templateId: string,
  action: "archive" | "restore",
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "archive") await templates.archiveTemplate(context, templateId);
    else await templates.restoreTemplate(context, templateId);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/templates/${templateId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export async function createInspectionAction(formData: FormData): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = inspectionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await inspections.createInspection(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/inspections/${id}`);
}

export async function updateInspectionAction(
  inspectionId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = inspectionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await inspections.updateInspection(context, inspectionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  return committed(`/qaqc/inspections/${inspectionId}`);
}

export async function assignInspectionAction(
  inspectionId: string,
  memberId: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await inspections.assignInspection(context, inspectionId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  return { ok: true, message: "Inspector assigned." };
}

/** Saves checklist answers (PRD #21 §71). */
export async function saveChecklistAction(
  inspectionId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();
  const { rows } = formValues(formData, "answers");

  const parsed = checklistSchema.safeParse({ answers: rows });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await inspections.saveChecklist(context, inspectionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  return { ok: true, message: "Answers saved." };
}

export async function submitInspectionAction(
  inspectionId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = submitInspectionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await inspections.submitInspection(context, inspectionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  return { ok: true, message: "Sent for approval." };
}

export type InspectionDecision = "approve" | "reject" | "close" | "cancel" | "rework" | "reopen";

/**
 * `cycle` is the approval cycle the page displayed: approving and rejecting
 * name it, and the service refuses a missing or replaced one inside its
 * transaction (AUD-10 §4, CW-02, CW-05). Other steps ignore it.
 */
export async function inspectionLifecycleAction(
  inspectionId: string,
  action: InspectionDecision,
  note: string | null,
  cycle?: PendingCycle | null,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "approve") await inspections.approveInspection(context, inspectionId, note, approvalGuardFrom(cycle));
    else if (action === "reject") {
      if (!note?.trim()) return { ok: false, error: "Say why it is being rejected." };
      await inspections.rejectInspection(context, inspectionId, note, approvalGuardFrom(cycle));
    } else if (action === "close") {
      await inspections.closeInspection(context, inspectionId, note);
    } else if (action === "cancel") {
      if (!note?.trim()) return { ok: false, error: "Say why it is being cancelled." };
      await inspections.cancelInspection(context, inspectionId, note);
    } else if (action === "rework") {
      await inspections.reworkInspection(context, inspectionId);
    } else {
      if (!note?.trim()) return { ok: false, error: "Say why it is being reopened." };
      await inspections.reopenInspection(context, inspectionId, note);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  return { ok: true };
}

export async function createReinspectionAction(
  parentInspectionId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = reinspectionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await inspections.createReinspection(context, parentInspectionId, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/inspections/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Material quality                                                            */
/* -------------------------------------------------------------------------- */

export async function recordMaterialDecisionAction(
  inspectionId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = materialDecisionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await materials.recordDecision(context, inspectionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  return { ok: true, message: "Decision recorded." };
}

export async function removeMaterialDecisionAction(
  inspectionId: string,
  goodsReceiptItemId: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await materials.removeDecision(context, inspectionId, goodsReceiptItemId);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  return { ok: true };
}

export async function releaseMaterialAction(
  inspectionId: string,
  notes: string | null,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await materials.releaseMaterial(context, inspectionId, notes);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  revalidatePath("/inventory", "layout");
  return { ok: true, message: "Material released to stock." };
}

export async function revokeReleaseAction(
  inspectionId: string,
  reason: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await materials.revokeRelease(context, inspectionId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/inspections/${inspectionId}`);
  revalidatePath("/inventory", "layout");
  return { ok: true, message: "Release revoked." };
}

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

export async function createDefectAction(formData: FormData): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = defectSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await defects.createDefect(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/defects/${id}`);
}

export async function updateDefectAction(
  defectId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = defectSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await defects.updateDefect(context, defectId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/defects/${defectId}`);
  return committed(`/qaqc/defects/${defectId}`);
}

export async function assignDefectAction(
  defectId: string,
  memberId: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await defects.assignDefect(context, defectId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/defects/${defectId}`);
  return { ok: true, message: "Defect assigned." };
}

export type DefectDecision = "resolve" | "close" | "reopen" | "cancel";

export async function defectLifecycleAction(
  defectId: string,
  action: DefectDecision,
  note: string | null,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "resolve") {
      if (!note?.trim()) return { ok: false, error: "Say what was done about it." };
      await defects.resolveDefect(context, defectId, note);
    } else if (action === "close") {
      await defects.closeDefect(context, defectId);
    } else if (action === "reopen") {
      if (!note?.trim()) return { ok: false, error: "Say why it is being reopened." };
      await defects.reopenDefect(context, defectId, note);
    } else {
      if (!note?.trim()) return { ok: false, error: "Say why it is being cancelled." };
      await defects.cancelDefect(context, defectId, note);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/defects/${defectId}`);
  return { ok: true };
}

/** Turning a defect into a formal non-conformance (PRD #21 §170). */
export async function escalateDefectAction(
  defectId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();
  const { values } = formValues(formData);

  // Validated against the enum rather than cast to it, so a hand-crafted form
  // post cannot write a category the reports will not understand.
  const parsed = escalateSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (
      await ncrs.escalateDefect(context, defectId, {
        category: parsed.data.category,
        title: parsed.data.title,
      })
    ).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/ncrs/${id}`);
}

/* -------------------------------------------------------------------------- */
/* NCRs                                                                        */
/* -------------------------------------------------------------------------- */

export async function createNcrAction(formData: FormData): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = ncrSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await ncrs.createNcr(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/ncrs/${id}`);
}

export async function updateNcrAction(
  ncrId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = ncrSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await ncrs.updateNcr(context, ncrId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/ncrs/${ncrId}`);
  return committed(`/qaqc/ncrs/${ncrId}`);
}

export async function assignNcrAction(
  ncrId: string,
  memberId: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await ncrs.assignNcr(context, ncrId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/ncrs/${ncrId}`);
  return { ok: true, message: "NCR assigned." };
}

export type NcrDecision =
  | "open"
  | "submit"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "cancel";

/** `cycle` as for inspections: the closure approval the page displayed (AUD-10 §4, CW-05). */
export async function ncrLifecycleAction(
  ncrId: string,
  action: NcrDecision,
  note: string | null,
  cycle?: PendingCycle | null,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "open") await ncrs.openNcr(context, ncrId);
    else if (action === "submit") await ncrs.submitNcr(context, ncrId);
    else if (action === "approve") await ncrs.approveNcr(context, ncrId, note, approvalGuardFrom(cycle));
    else if (action === "reject") {
      if (!note?.trim()) return { ok: false, error: "Say why the closure is being rejected." };
      await ncrs.rejectNcr(context, ncrId, note, approvalGuardFrom(cycle));
    } else if (action === "close") {
      await ncrs.closeNcr(context, ncrId, note);
    } else if (action === "reopen") {
      if (!note?.trim()) return { ok: false, error: "Say why it is being reopened." };
      await ncrs.reopenNcr(context, ncrId, note);
    } else {
      if (!note?.trim()) return { ok: false, error: "Say why it is being cancelled." };
      await ncrs.cancelNcr(context, ncrId, note);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/ncrs/${ncrId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Corrective actions                                                          */
/* -------------------------------------------------------------------------- */

export async function createActionAction(formData: FormData): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = correctiveActionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await actions.createAction(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc();
  return committed(`/qaqc/corrective-actions/${id}`);
}

export async function updateActionAction(
  actionId: string,
  formData: FormData,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  const parsed = correctiveActionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await actions.updateAction(context, actionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/corrective-actions/${actionId}`);
  return committed(`/qaqc/corrective-actions/${actionId}`);
}

export async function assignActionAction(
  actionId: string,
  memberId: string,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    await actions.assignAction(context, actionId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/corrective-actions/${actionId}`);
  return { ok: true, message: "Action assigned." };
}

export type ActionDecision = "complete" | "verify" | "reject" | "reopen" | "cancel";

export async function actionLifecycleAction(
  actionId: string,
  action: ActionDecision,
  note: string | null,
): Promise<QaqcActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "complete") {
      if (!note?.trim()) return { ok: false, error: "Say what was done." };
      await actions.completeAction(context, actionId, note);
    } else if (action === "verify") {
      await actions.verifyAction(context, actionId, note);
    } else if (action === "reject") {
      if (!note?.trim()) return { ok: false, error: "Say why it is being sent back." };
      await actions.rejectAction(context, actionId, note);
    } else if (action === "reopen") {
      if (!note?.trim()) return { ok: false, error: "Say why it is being reopened." };
      await actions.reopenAction(context, actionId, note);
    } else {
      if (!note?.trim()) return { ok: false, error: "Say why it is being cancelled." };
      await actions.cancelAction(context, actionId, note);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateQaqc(`/qaqc/corrective-actions/${actionId}`);
  return { ok: true };
}
