import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { createDailyLogSchema, SECTION_SCHEMAS, transitionSchema, updateDailyLogSchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { addEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { submitDailyLog } from "@/lib/modules/daily-logs/daily-log.review";
import { createDailyLog, readDailyLogState, updateDailyLog } from "@/lib/modules/daily-logs/daily-log.service";

import type { SyncAdapter } from "./types";

const ENTITY = "DailyLog";

function targetId(operation: { target: { entityId: string } | null }): string {
  if (!operation.target) throw new AccessError("VALIDATION_ERROR", "This change does not say which daily log it is for.", { code: "TARGET_REQUIRED" });
  return operation.target.entityId;
}

const describe: SyncAdapter["describeCurrent"] = async (context, operation) => {
  if (!operation.target) return undefined;
  try {
    const state = await readDailyLogState(context, operation.target.entityId);
    return { status: state.status, version: state.version };
  } catch {
    return undefined;
  }
};

/** Starts the day's log. A day that already has one answers with that log, so a retry or a second device lands in the same record (PRD #43 §17). */
export const siteDiaryCreate: SyncAdapter = {
  type: "SITE_DIARY_CREATE",
  requiresVersion: false,
  async run(context, operation) {
    const input = createDailyLogSchema.parse({ projectId: operation.projectId, workDate: operation.payload.workDate });
    const { id } = await createDailyLog(context, input);
    const state = await readDailyLogState(context, id);
    return { entityType: ENTITY, entityId: id, serverVersion: state.version };
  },
};

export const siteDiaryUpdateDraft: SyncAdapter = {
  type: "SITE_DIARY_UPDATE_DRAFT",
  requiresVersion: true,
  async run(context, operation) {
    const id = targetId(operation);
    const input = updateDailyLogSchema.parse({ ...operation.payload, expectedVersion: operation.expectedVersion });
    const { version } = await updateDailyLog(context, id, input);
    return { entityType: ENTITY, entityId: id, serverVersion: version };
  },
  describeCurrent: describe,
};

const entryPayload = z.object({ section: z.enum(Object.keys(SECTION_SCHEMAS) as [keyof typeof SECTION_SCHEMAS, ...Array<keyof typeof SECTION_SCHEMAS>]), input: z.record(z.string(), z.unknown()) });

/** One row in a section (work done, workforce, …). Append-only, so it never conflicts with another writer; it does move the log's version, which the device carries forward. */
export const siteDiaryAddEntry: SyncAdapter = {
  type: "SITE_DIARY_ADD_ENTRY",
  requiresVersion: false,
  async run(context, operation) {
    const id = targetId(operation);
    const { section, input } = entryPayload.parse(operation.payload);
    const parsed = SECTION_SCHEMAS[section].parse(input);
    // The schemas differ per section; `addEntry` is generic over the section key.
    const { id: entryId, version } = await addEntry(context, id, section, parsed as never);
    return { entityType: ENTITY, entityId: id, serverVersion: version, childId: entryId };
  },
  describeCurrent: describe,
};

export const siteDiarySubmit: SyncAdapter = {
  type: "SITE_DIARY_SUBMIT",
  requiresVersion: true,
  async run(context, operation) {
    const id = targetId(operation);
    const input = transitionSchema.parse({ expectedVersion: operation.expectedVersion });
    // A submit that committed but whose record was lost (response dropped, ledger not written) is done, not a conflict.
    const before = await readDailyLogState(context, id);
    if (before.submittedByMe && before.status !== "DRAFT" && before.status !== "CORRECTION_REQUIRED") {
      return { entityType: ENTITY, entityId: id, serverVersion: before.version };
    }
    await submitDailyLog(context, id, input);
    const after = await readDailyLogState(context, id);
    return { entityType: ENTITY, entityId: id, serverVersion: after.version };
  },
  describeCurrent: describe,
};
