"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireCompanyContext } from "@/lib/context/current-user";
import { committed } from "@/lib/forms/committed";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import * as ppe from "@/lib/modules/hse/ppe/ppe.service";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import * as stopWork from "@/lib/modules/hse/stop-work/stop-work.service";
import * as templates from "@/lib/modules/hse/templates/template.service";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";
import {
  actionSchema,
  executeInspectionSchema,
  hazardAssessSchema,
  hazardCloseSchema,
  hazardControlSchema,
  hazardSchema,
  incidentSchema,
  inspectionSchema,
  investigationSchema,
  observationSchema,
  permitSchema,
  ppeCheckSchema,
  riskAssessmentSchema,
  stopWorkSchema,
  submitInspectionSchema,
  templateSchema,
  toolboxSchema,
} from "@/lib/modules/hse/hse.schema";

/**
 * Server actions for the HSE module (PRD #22 §249).
 *
 * A thin shell over the same services the pages call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 *
 * Nothing here computes a risk score either. The form posts a likelihood and a
 * severity; the service multiplies them (PRD #22 §243).
 */

/**
 * An editor's action answers where the saved record lives instead of
 * redirecting, so the form can tell the save committed (AUD-03 §6). Only the
 * input-less starts (inspection, investigation) still redirect.
 */
export type HseActionResult =
  | { ok: true; id?: string; message?: string; redirectTo?: string }
  | {
      ok: false;
      error: string;
      code?: string;
      gaps?: unknown;
      fieldErrors?: Record<string, string[]>;
    };

function revalidateHse(recordPath?: string) {
  revalidatePath("/hse", "layout");
  if (recordPath) revalidatePath(recordPath, "layout");
  revalidatePath("/dashboard");
}

function toResult(error: unknown): HseActionResult {
  if (error instanceof AccessError) {
    const details = error.details as { code?: string; gaps?: unknown } | undefined;
    return { ok: false, error: error.message, code: details?.code, gaps: details?.gaps };
  }

  console.error("[hse] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function invalid(error: { flatten(): { fieldErrors: unknown } }): HseActionResult {
  return {
    ok: false,
    error: "Please review the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
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
function checked(value: unknown): boolean {
  return value === "on" || value === "true" || value === true;
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export async function createTemplateAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const { values, rows } = formValues(formData);
  const parsed = templateSchema.safeParse({
    ...values,
    items: rows.map((row) => ({
      ...row,
      required: checked(row.required),
      requiresNoteOnFail: checked(row.requiresNoteOnFail),
      riskIfFailed: row.riskIfFailed || undefined,
    })),
  });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await templates.createTemplate(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/templates/${id}`);
}

export async function updateTemplateAction(
  templateId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const { values, rows } = formValues(formData);
  const parsed = templateSchema.safeParse({
    ...values,
    items: rows.map((row) => ({
      ...row,
      required: checked(row.required),
      requiresNoteOnFail: checked(row.requiresNoteOnFail),
      riskIfFailed: row.riskIfFailed || undefined,
    })),
  });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    // May return a different id: editing a used checklist creates a version
    // rather than rewriting it (PRD #22 §349).
    id = (await templates.updateTemplate(context, templateId, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/templates/${templateId}`);
  return committed(`/hse/templates/${id}`);
}

export async function archiveTemplateAction(templateId: string): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await templates.archiveTemplate(context, templateId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/templates/${templateId}`);
  return { ok: true, message: "Checklist archived." };
}

export async function restoreTemplateAction(templateId: string): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await templates.restoreTemplate(context, templateId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/templates/${templateId}`);
  return { ok: true, message: "Checklist restored." };
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export async function createInspectionAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = inspectionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await inspections.createInspection(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/inspections/${id}`);
}

export async function updateInspectionAction(
  inspectionId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = inspectionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await inspections.updateInspection(context, inspectionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return committed(`/hse/inspections/${inspectionId}`);
}

export async function assignInspectionAction(
  inspectionId: string,
  memberId: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await inspections.assignInspection(context, inspectionId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return { ok: true, message: "Inspector assigned." };
}

export async function startInspectionAction(inspectionId: string): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await inspections.startInspection(context, inspectionId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  redirect(`/hse/inspections/${inspectionId}/execute`);
}

export async function executeInspectionAction(
  inspectionId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const { values, rows } = formValues(formData, "answers");
  const parsed = executeInspectionSchema.safeParse({
    versionUpdatedAt: values.versionUpdatedAt,
    answers: rows.map((row) => ({
      itemId: row.itemId,
      result: row.result || undefined,
      responseValue: row.responseValue || undefined,
      note: row.note || undefined,
    })),
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await inspections.executeInspection(context, inspectionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return { ok: true, message: "Checklist saved." };
}

export async function submitInspectionAction(
  inspectionId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = submitInspectionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await inspections.submitInspection(context, inspectionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return committed(`/hse/inspections/${inspectionId}`);
}

export async function approveInspectionAction(
  inspectionId: string,
  decisionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await inspections.approveInspection(context, inspectionId, decisionNote || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return { ok: true, message: "Inspection approved." };
}

export async function rejectInspectionAction(
  inspectionId: string,
  decisionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!decisionNote.trim()) {
    return { ok: false, error: "Say why it is being sent back." };
  }

  try {
    await inspections.rejectInspection(context, inspectionId, decisionNote);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return { ok: true, message: "Inspection sent back." };
}

export async function closeInspectionAction(
  inspectionId: string,
  disposition: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await inspections.closeInspection(context, inspectionId, disposition || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return { ok: true, message: "Inspection closed." };
}

export async function cancelInspectionAction(
  inspectionId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await inspections.cancelInspection(context, inspectionId, reason || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/inspections/${inspectionId}`);
  return { ok: true, message: "Inspection cancelled." };
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

export async function createHazardAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = hazardSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await hazards.createHazard(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/hazards/${id}`);
}

export async function updateHazardAction(
  hazardId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = hazardSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await hazards.updateHazard(context, hazardId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/hazards/${hazardId}`);
  return committed(`/hse/hazards/${hazardId}`);
}

export async function assignHazardAction(
  hazardId: string,
  memberId: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await hazards.assignHazard(context, hazardId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/hazards/${hazardId}`);
  return { ok: true, message: "Hazard assigned." };
}

export async function assessHazardAction(
  hazardId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = hazardAssessSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await hazards.assessHazard(context, hazardId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/hazards/${hazardId}`);
  return { ok: true, message: "Risk reassessed." };
}

export async function controlHazardAction(
  hazardId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = hazardControlSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await hazards.controlHazard(context, hazardId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/hazards/${hazardId}`);
  return { ok: true, message: "Control recorded." };
}

export async function closeHazardAction(
  hazardId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = hazardCloseSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await hazards.closeHazard(context, hazardId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/hazards/${hazardId}`);
  // Back to the hazard: the close page no longer applies once it is closed (AUD-03 §6).
  return { ...committed(`/hse/hazards/${hazardId}`), message: "Hazard closed." };
}

export async function reopenHazardAction(
  hazardId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!reason.trim()) return { ok: false, error: "Say why it is being reopened." };

  try {
    await hazards.reopenHazard(context, hazardId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/hazards/${hazardId}`);
  return { ok: true, message: "Hazard reopened." };
}

export async function cancelHazardAction(
  hazardId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await hazards.cancelHazard(context, hazardId, reason || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/hazards/${hazardId}`);
  return { ok: true, message: "Hazard cancelled." };
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

function incidentValues(formData: FormData) {
  const { values } = formValues(formData);
  return {
    ...values,
    injuryOccurred: checked(values.injuryOccurred),
    firstAidRequired: checked(values.firstAidRequired),
    medicalTreatmentRequired: checked(values.medicalTreatmentRequired),
    lostTime: checked(values.lostTime),
    propertyDamage: checked(values.propertyDamage),
    environmentalImpact: checked(values.environmentalImpact),
  };
}

export async function createIncidentAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = incidentSchema.safeParse(incidentValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await incidents.createIncident(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/incidents/${id}`);
}

export async function updateIncidentAction(
  incidentId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = incidentSchema.safeParse(incidentValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await incidents.updateIncident(context, incidentId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  return committed(`/hse/incidents/${incidentId}`);
}

export async function assignInvestigatorAction(
  incidentId: string,
  memberId: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await incidents.assignInvestigator(context, incidentId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  return { ok: true, message: "Investigator assigned." };
}

export async function startInvestigationAction(
  incidentId: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await incidents.startInvestigation(context, incidentId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  redirect(`/hse/incidents/${incidentId}/investigation`);
}

export async function recordInvestigationAction(
  incidentId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = investigationSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await incidents.recordInvestigation(context, incidentId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  return { ok: true, message: "Investigation saved." };
}

export async function submitIncidentCloseAction(
  incidentId: string,
  closureNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!closureNote.trim()) return { ok: false, error: "Write a closure note." };

  try {
    await incidents.submitIncidentClose(context, incidentId, closureNote);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  return { ok: true, message: "Sent for closure." };
}

export async function closeIncidentAction(
  incidentId: string,
  decisionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await incidents.closeIncident(context, incidentId, decisionNote || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  return { ok: true, message: "Incident closed." };
}

export async function reopenIncidentAction(
  incidentId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!reason.trim()) return { ok: false, error: "Say why it is being reopened." };

  try {
    await incidents.reopenIncident(context, incidentId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  return { ok: true, message: "Incident reopened." };
}

export async function cancelIncidentAction(
  incidentId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await incidents.cancelIncident(context, incidentId, reason || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/incidents/${incidentId}`);
  return { ok: true, message: "Incident cancelled." };
}

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

function riskValues(formData: FormData) {
  const { values, rows } = formValues(formData);
  return {
    ...values,
    items: rows.map((row) => ({
      ...row,
      residualLikelihood: row.residualLikelihood || undefined,
      residualSeverity: row.residualSeverity || undefined,
      responsibleMemberId: row.responsibleMemberId || undefined,
      dueDate: row.dueDate || undefined,
    })),
  };
}

export async function createRiskAssessmentAction(
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = riskAssessmentSchema.safeParse(riskValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await risk.createRiskAssessment(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/risk-assessments/${id}`);
}

export async function updateRiskAssessmentAction(
  assessmentId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = riskAssessmentSchema.safeParse(riskValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    // May return a different id: editing an approved assessment versions it
    // rather than rewriting what people worked to (PRD #22 §112).
    id = (await risk.updateRiskAssessment(context, assessmentId, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/risk-assessments/${assessmentId}`);
  return committed(`/hse/risk-assessments/${id}`);
}

export async function submitRiskAssessmentAction(
  assessmentId: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await risk.submitRiskAssessment(context, assessmentId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/risk-assessments/${assessmentId}`);
  return { ok: true, message: "Sent for approval." };
}

export async function approveRiskAssessmentAction(
  assessmentId: string,
  decisionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await risk.approveRiskAssessment(context, assessmentId, decisionNote || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/risk-assessments/${assessmentId}`);
  return { ok: true, message: "Risk assessment approved." };
}

export async function rejectRiskAssessmentAction(
  assessmentId: string,
  decisionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!decisionNote.trim()) return { ok: false, error: "Say why it is being sent back." };

  try {
    await risk.rejectRiskAssessment(context, assessmentId, decisionNote);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/risk-assessments/${assessmentId}`);
  return { ok: true, message: "Risk assessment sent back." };
}

export async function archiveRiskAssessmentAction(
  assessmentId: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await risk.archiveRiskAssessment(context, assessmentId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/risk-assessments/${assessmentId}`);
  return { ok: true, message: "Risk assessment archived." };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export async function createHseActionAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = actionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await actionService.createAction(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/actions/${id}`);
}

export async function updateHseActionAction(
  actionId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = actionSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await actionService.updateAction(context, actionId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  return committed(`/hse/actions/${actionId}`);
}

export async function assignHseActionAction(
  actionId: string,
  memberId: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await actionService.assignAction(context, actionId, memberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  return { ok: true, message: "Action assigned." };
}

export async function completeHseActionAction(
  actionId: string,
  completionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!completionNote.trim()) return { ok: false, error: "Record what was done." };

  try {
    await actionService.completeAction(context, actionId, completionNote);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  return { ok: true, message: "Action completed. Somebody else verifies it." };
}

export async function verifyHseActionAction(
  actionId: string,
  verificationNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await actionService.verifyAction(context, actionId, verificationNote || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  return { ok: true, message: "Action verified." };
}

export async function rejectHseActionAction(
  actionId: string,
  verificationNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!verificationNote.trim()) return { ok: false, error: "Say what is still wrong." };

  try {
    await actionService.rejectAction(context, actionId, verificationNote);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  return { ok: true, message: "Action sent back." };
}

export async function reopenHseActionAction(
  actionId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!reason.trim()) return { ok: false, error: "Say why it is being reopened." };

  try {
    await actionService.reopenAction(context, actionId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  return { ok: true, message: "Action reopened." };
}

export async function cancelHseActionAction(
  actionId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await actionService.cancelAction(context, actionId, reason || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  return { ok: true, message: "Action cancelled." };
}

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

function toolboxValues(formData: FormData) {
  const { values, rows } = formValues(formData, "participants");
  return {
    ...values,
    participants: rows
      .filter((row) => row.companyMemberId || (row.externalName ?? "").trim())
      .map((row) => ({
        companyMemberId: row.companyMemberId || undefined,
        externalName: row.externalName || undefined,
        attendanceStatus: row.attendanceStatus || "ATTENDED",
        signatureRecorded: checked(row.signatureRecorded),
      })),
  };
}

export async function createToolboxTalkAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = toolboxSchema.safeParse(toolboxValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await toolbox.createToolboxTalk(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/toolbox-talks/${id}`);
}

export async function updateToolboxTalkAction(
  talkId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = toolboxSchema.safeParse(toolboxValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await toolbox.updateToolboxTalk(context, talkId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/toolbox-talks/${talkId}`);
  return committed(`/hse/toolbox-talks/${talkId}`);
}

export async function completeToolboxTalkAction(talkId: string): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await toolbox.completeToolboxTalk(context, talkId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/toolbox-talks/${talkId}`);
  return { ok: true, message: "Toolbox talk completed." };
}

export async function cancelToolboxTalkAction(
  talkId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await toolbox.cancelToolboxTalk(context, talkId, reason || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/toolbox-talks/${talkId}`);
  return { ok: true, message: "Toolbox talk cancelled." };
}

/* -------------------------------------------------------------------------- */
/* Work permits                                                                */
/* -------------------------------------------------------------------------- */

export async function createPermitAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = permitSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await permits.createPermit(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/permits/${id}`);
}

export async function updatePermitAction(
  permitId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = permitSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await permits.updatePermit(context, permitId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return committed(`/hse/permits/${permitId}`);
}

export async function submitPermitAction(permitId: string): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await permits.submitPermit(context, permitId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return { ok: true, message: "Permit sent for approval." };
}

export async function approvePermitAction(
  permitId: string,
  decisionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await permits.approvePermit(context, permitId, decisionNote || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return { ok: true, message: "Permit approved." };
}

export async function rejectPermitAction(
  permitId: string,
  decisionNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!decisionNote.trim()) return { ok: false, error: "Say why it is being refused." };

  try {
    await permits.rejectPermit(context, permitId, decisionNote);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return { ok: true, message: "Permit sent back." };
}

export async function activatePermitAction(permitId: string): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await permits.activatePermit(context, permitId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return { ok: true, message: "Permit active." };
}

export async function suspendPermitAction(
  permitId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!reason.trim()) return { ok: false, error: "Say why it is being suspended." };

  try {
    await permits.suspendPermit(context, permitId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return { ok: true, message: "Permit suspended." };
}

export async function closePermitAction(permitId: string): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await permits.closePermit(context, permitId);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return { ok: true, message: "Permit closed." };
}

export async function cancelPermitAction(
  permitId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await permits.cancelPermit(context, permitId, reason || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/permits/${permitId}`);
  return { ok: true, message: "Permit cancelled." };
}

/* -------------------------------------------------------------------------- */
/* PPE checks                                                                  */
/* -------------------------------------------------------------------------- */

export async function createPpeCheckAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = ppeCheckSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await ppe.createPpeCheck(context, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse("/hse/ppe");
  return committed("/hse/ppe");
}

export async function updatePpeCheckAction(
  checkId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = ppeCheckSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await ppe.updatePpeCheck(context, checkId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse("/hse/ppe");
  return committed("/hse/ppe");
}

/* -------------------------------------------------------------------------- */
/* Environmental observations                                                  */
/* -------------------------------------------------------------------------- */

export async function createObservationAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = observationSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await environment.createObservation(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/environment/${id}`);
}

export async function updateObservationAction(
  observationId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = observationSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await environment.updateObservation(context, observationId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/environment/${observationId}`);
  return committed(`/hse/environment/${observationId}`);
}

export async function closeObservationAction(
  observationId: string,
  closureNote: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!closureNote.trim()) return { ok: false, error: "Write a closure note." };

  try {
    await environment.closeObservation(context, observationId, closureNote);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/environment/${observationId}`);
  return { ok: true, message: "Observation closed." };
}

export async function reopenObservationAction(
  observationId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!reason.trim()) return { ok: false, error: "Say why it is being reopened." };

  try {
    await environment.reopenObservation(context, observationId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/environment/${observationId}`);
  return { ok: true, message: "Observation reopened." };
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export async function createStopWorkAction(formData: FormData): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const parsed = stopWorkSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await stopWork.createStopWork(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateHse();
  return committed(`/hse/stop-work/${id}`);
}

export async function releaseStopWorkAction(
  stopWorkId: string,
  releaseReason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  if (!releaseReason.trim()) return { ok: false, error: "Say why it is safe to resume." };

  try {
    await stopWork.releaseStopWork(context, stopWorkId, releaseReason);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/stop-work/${stopWorkId}`);
  return { ok: true, message: "Work released." };
}

export async function cancelStopWorkAction(
  stopWorkId: string,
  reason: string,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  try {
    await stopWork.cancelStopWork(context, stopWorkId, reason || null);
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/stop-work/${stopWorkId}`);
  return { ok: true, message: "Stop-work cancelled." };
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Raises a canonical Task to discharge an HSE action (PRD #22 §126, §127).
 *
 * The Task is the work item; the action keeps its own verification lifecycle.
 * Creating one never closes or advances the action (PRD #22 §128).
 */
export async function createHseTaskAction(
  actionId: string,
  formData: FormData,
): Promise<HseActionResult> {
  const context = await requireCompanyContext();

  const title = text(formData.get("title")).trim();
  if (!title) return { ok: false, error: "Give the task a title." };

  const due = text(formData.get("dueDate"));

  try {
    await actionService.createTaskForAction(context, actionId, {
      title,
      description: text(formData.get("description")) || null,
      assigneeMemberId: text(formData.get("assigneeMemberId")) || null,
      dueDate: due ? new Date(due) : undefined,
    });
  } catch (error) {
    return toResult(error);
  }

  revalidateHse(`/hse/actions/${actionId}`);
  // Back to the action, so a second click cannot create the task twice (AUD-03 §6).
  return { ...committed(`/hse/actions/${actionId}`), message: "Task created." };
}
