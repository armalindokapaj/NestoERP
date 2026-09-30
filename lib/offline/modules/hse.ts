import { INCIDENT_TYPES, SEVERITIES } from "@/lib/modules/hse/hse.status";

import type { OfflineDatabase } from "../database";
import { enqueue, newLocalId } from "../queue";
import type { MutationRecord } from "../types";

/**
 * HSE reporting offline (MOB-09 §49, §50).
 *
 * The report is kept on the device and sent when there is a connection. Until
 * the server has it, the screen says so plainly: nobody responsible has been
 * told, and for a serious report that is the thing the person must know.
 */

export const HSE_TARGET = "HseIncident";

export type HseReportInput = {
  incidentType: (typeof INCIDENT_TYPES)[number];
  severity: (typeof SEVERITIES)[number];
  title: string;
  description: string;
  locationText?: string | null;
  occurredAt: string;
  immediateAction?: string | null;
  injuryOccurred?: boolean;
};

export const UNSENT_NOTICE = "This report is stored on this device and has NOT reached the server yet.";

export type HseValidation = { ok: true } | { ok: false; field: string; message: string };

/** The server's rules, applied first so nothing is queued that the server would refuse outright (PRD #22 §85, §362). */
export function validateHseReport(input: HseReportInput, now: number = Date.now()): HseValidation {
  if (!(INCIDENT_TYPES as readonly string[]).includes(input.incidentType)) return { ok: false, field: "incidentType", message: "Choose what kind of report this is." };
  if (!(SEVERITIES as readonly string[]).includes(input.severity)) return { ok: false, field: "severity", message: "Choose how serious it is." };
  if (input.title.trim().length < 3) return { ok: false, field: "title", message: "Give it a short title." };
  if (input.description.trim().length < 3) return { ok: false, field: "description", message: "Say what happened." };
  const occurred = new Date(input.occurredAt).getTime();
  if (!Number.isFinite(occurred)) return { ok: false, field: "occurredAt", message: "Say when it happened." };
  // A phone clock a few minutes ahead must not refuse a report made right now; the server clamps the same way.
  if (occurred > now + 10 * 60_000) return { ok: false, field: "occurredAt", message: "It cannot have happened in the future." };
  if ((input.severity === "HIGH" || input.severity === "CRITICAL") && !(input.immediateAction ?? "").trim()) return { ok: false, field: "immediateAction", message: "A high or critical report needs the immediate action taken." };
  return { ok: true };
}

export function isSerious(severity: string): boolean {
  return severity === "HIGH" || severity === "CRITICAL";
}

export async function queueHseReport(db: OfflineDatabase, input: { companyId: string; projectId: string; projectLabel: string; report: HseReportInput }): Promise<string> {
  const verdict = validateHseReport(input.report);
  if (!verdict.ok) throw new Error(verdict.message);
  const record = await enqueue(db, {
    type: "HSE_CREATE",
    companyId: input.companyId,
    projectId: input.projectId,
    targetType: HSE_TARGET,
    targetId: newLocalId("hse-report"),
    label: `HSE report · ${input.report.title.trim()} · ${input.projectLabel}`,
    payload: { ...input.report, title: input.report.title.trim(), description: input.report.description.trim() },
  });
  return record.id;
}

export type PendingHseReport = { mutationId: string; title: string; severity: string; serious: boolean; state: MutationRecord["state"]; message: string | null };

export async function pendingHseReports(db: OfflineDatabase, projectId: string): Promise<PendingHseReport[]> {
  return (await db.listMutations())
    .filter(({ record }) => record.type === "HSE_CREATE" && record.projectId === projectId)
    .map(({ record, body }) => ({ mutationId: record.id, title: String(body.payload.title), severity: String(body.payload.severity), serious: isSerious(String(body.payload.severity)), state: record.state, message: body.errorMessage ?? null }));
}
