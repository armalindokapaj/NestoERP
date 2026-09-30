import { newUploadKey } from "@/components/documents/upload-client";

import type { OfflineDatabase } from "../database";
import { discard, enqueue, isLocalId, newLocalId, newOperationId, unsettledFor, VERSIONED_TYPES } from "../queue";
import type { MutationBody, MutationRecord, MutationState, SyncState } from "../types";

/**
 * The Site Diary offline (MOB-09 §36-§39, §40-§43, §149).
 *
 * The diary is not a second record: it is a chain of queued changes — start the
 * day, edit the notes, add rows, attach photos, submit — that the server applies
 * through the daily-log service. What the person sees offline is the server's
 * last copy with that chain laid over it, and it says "Saved on this device" /
 * "Submission queued", never "Submitted", until the server has said so.
 */

export const DIARY_TARGET = "DailyLog";

export type DiaryFields = {
  summary?: string | null;
  generalNotes?: string | null;
  delaySummary?: string | null;
  weatherSummary?: string | null;
  siteCondition?: string | null;
  siteConditionNotes?: string | null;
};

export type DiaryEntrySection = "activities" | "workforce";

export type DiaryPhotoView = { fileId: string; mutationId: string; name: string; state: MutationState; fileState: string; progress: number; message?: string };
export type DiaryEntryView = { mutationId: string; section: DiaryEntrySection; input: Record<string, unknown>; state: MutationState };

export type LocalDiaryView = {
  /** The id the device uses: `local:…` until the server has made the log. */
  targetId: string;
  localOnly: boolean;
  projectId: string;
  companyId: string;
  workDate: string | null;
  fields: DiaryFields;
  entries: DiaryEntryView[];
  photos: DiaryPhotoView[];
  submission: { queued: boolean; mutationId: string | null; state: MutationState | null };
  syncState: SyncState;
  /** Something in the chain needs a person: the first such change, with the reason. */
  attention: { mutationId: string; state: MutationState; message: string | null; label: string } | null;
};

type ServerDiary = { id: string; version: number; status: string; workDate: string };

async function serverDiaryVersion(db: OfflineDatabase, projectId: string, id: string): Promise<ServerDiary | null> {
  for (const kind of ["dailyLogDrafts", "dailyLogs"] as const) {
    const hit = await db.getCache<{ id: string; version?: number; status: string; workDate: string }>(projectId, kind, id);
    if (hit && typeof hit.data.version === "number") return { id, version: hit.data.version, status: hit.data.status, workDate: hit.data.workDate };
  }
  return null;
}

/**
 * Begins (or returns) the day's diary. A day that already has a diary on the
 * server, or one already started on this device, is that one — never a second.
 */
export async function startDiary(db: OfflineDatabase, input: { companyId: string; projectId: string; workDate: string; projectLabel: string }): Promise<string> {
  const pending = (await db.listMutations()).find(({ record, body }) => record.type === "SITE_DIARY_CREATE" && record.projectId === input.projectId && body.payload.workDate === input.workDate);
  if (pending) return pending.record.targetId;
  const cached = await db.listCache<{ id: string; workDate: string }>(input.projectId, "dailyLogs");
  const existing = cached.find((row) => row.data.workDate === input.workDate);
  if (existing) return existing.data.id;

  const targetId = newLocalId("site-diary");
  await enqueue(db, { type: "SITE_DIARY_CREATE", companyId: input.companyId, projectId: input.projectId, targetType: DIARY_TARGET, targetId, label: `Site Diary · ${input.projectLabel}`, payload: { workDate: input.workDate } });
  return targetId;
}

async function createDependency(db: OfflineDatabase, targetId: string): Promise<string[]> {
  const create = (await unsettledFor(db, targetId, ["SITE_DIARY_CREATE"]))[0];
  return create ? [create.id] : [];
}

/** Edits the notes. While the previous edit has not been sent, it is replaced, so the queue does not grow with every keystroke. */
export async function saveDiaryFields(db: OfflineDatabase, input: { targetId: string; companyId: string; projectId: string; label: string; fields: DiaryFields }): Promise<void> {
  const { targetId } = input;
  const open = (await unsettledFor(db, targetId, ["SITE_DIARY_UPDATE_DRAFT"])).find((row) => row.state === "PENDING");
  if (open) {
    const stored = await db.getMutation(open.id);
    await db.patchMutation(open.id, {}, { payload: { ...(stored?.body.payload ?? {}), ...input.fields } });
    return;
  }
  const version = isLocalId(targetId) ? null : ((await serverDiaryVersion(db, input.projectId, targetId))?.version ?? null);
  await enqueue(db, {
    type: "SITE_DIARY_UPDATE_DRAFT",
    companyId: input.companyId,
    projectId: input.projectId,
    targetType: DIARY_TARGET,
    targetId,
    label: input.label,
    payload: { ...input.fields },
    expectedVersion: version,
    dependsOn: await createDependency(db, targetId),
  });
}

type DiaryContext = { companyId: string; projectId: string; label: string };

export async function addDiaryEntry(db: OfflineDatabase, input: DiaryContext & { targetId: string; section: DiaryEntrySection; entry: Record<string, unknown> }): Promise<string> {
  const base = input;
  const record = await enqueue(db, {
    type: "SITE_DIARY_ADD_ENTRY",
    companyId: base.companyId,
    projectId: base.projectId,
    targetType: DIARY_TARGET,
    targetId: input.targetId,
    label: base.label,
    payload: { section: input.section, input: input.entry },
    dependsOn: await createDependency(db, input.targetId),
  });
  return record.id;
}

/** Removes a row that has not been sent yet. One already on the server is edited online. */
export async function removeDiaryEntry(db: OfflineDatabase, mutationId: string): Promise<void> {
  const stored = await db.getMutation(mutationId);
  if (stored?.record.type === "SITE_DIARY_ADD_ENTRY" && stored.record.state !== "SYNCING") await discard(db, mutationId);
}

/**
 * Keeps a captured photo. Returns only once the bytes are stored, so what the
 * person sees confirmed is on the device and survives a restart (§41).
 */
export async function addDiaryPhoto(
  db: OfflineDatabase,
  input: DiaryContext & { targetId: string; file: Blob; name: string; mime: string; category?: string; caption?: string | null; takenTime?: string | null },
): Promise<{ fileId: string; mutationId: string }> {
  const base = input;
  const fileId = `file_${globalThis.crypto.randomUUID()}`;
  const mutationId = newOperationId();
  const bytes = await input.file.arrayBuffer();
  // Bytes first: a change that points at nothing is harmless, bytes with no change are swept at startup.
  await db.putFile(
    { id: fileId, companyId: base.companyId, projectId: base.projectId, mutationId, state: "PENDING", uploadKey: newUploadKey(), size: bytes.byteLength, createdAt: Date.now(), progress: 0 },
    { name: input.name, mime: input.mime, category: input.category ?? "PHOTO", caption: input.caption ?? null, takenTime: input.takenTime ?? null },
    bytes,
  );
  await enqueue(db, {
    id: mutationId,
    type: "ATTACHMENT_CREATE",
    companyId: base.companyId,
    projectId: base.projectId,
    targetType: DIARY_TARGET,
    targetId: input.targetId,
    label: `Photo · ${input.name}`,
    payload: { fileId },
    dependsOn: await createDependency(db, input.targetId),
  });
  return { fileId, mutationId };
}

/** Removes a photo that has not reached the server. */
export async function removeDiaryPhoto(db: OfflineDatabase, mutationId: string): Promise<void> {
  const stored = await db.getMutation(mutationId);
  if (stored?.record.type === "ATTACHMENT_CREATE" && stored.record.state !== "SYNCING") await discard(db, mutationId);
}

/** Queues the submission behind everything the diary still has to send (§34, §38). */
export async function submitDiary(db: OfflineDatabase, input: { targetId: string; companyId: string; projectId: string; label: string }): Promise<string> {
  const existing = (await unsettledFor(db, input.targetId, ["SITE_DIARY_SUBMIT"]))[0];
  if (existing) return existing.id;
  const earlier = await unsettledFor(db, input.targetId);
  const version = isLocalId(input.targetId) ? null : ((await serverDiaryVersion(db, input.projectId, input.targetId))?.version ?? null);
  const record = await enqueue(db, {
    type: "SITE_DIARY_SUBMIT",
    companyId: input.companyId,
    projectId: input.projectId,
    targetType: DIARY_TARGET,
    targetId: input.targetId,
    label: input.label,
    payload: {},
    expectedVersion: version,
    dependsOn: earlier.map((row) => row.id),
  });
  return record.id;
}

/** Removes stored photo bytes whose change no longer exists (a crash between the two writes of `addDiaryPhoto`). */
export async function sweepOrphanFiles(db: OfflineDatabase): Promise<number> {
  const mutations = new Set((await db.listMutationRecords()).map((row) => row.id));
  let swept = 0;
  for (const file of await db.listFiles()) {
    if (!mutations.has(file.record.mutationId)) {
      await db.removeFile(file.record.id);
      swept += 1;
    }
  }
  return swept;
}

/** The diaries the device is holding changes for, each with its chain laid out for the screen. */
export async function composeDiaries(db: OfflineDatabase, projectId: string): Promise<LocalDiaryView[]> {
  const all = (await db.listMutations()).filter(({ record }) => record.projectId === projectId && record.targetType === DIARY_TARGET);
  const files = new Map((await db.listFiles()).map((file) => [file.record.mutationId, file]));
  const groups = new Map<string, Array<{ record: MutationRecord; body: MutationBody }>>();
  for (const row of all) groups.set(row.record.targetId, [...(groups.get(row.record.targetId) ?? []), row]);

  const views: LocalDiaryView[] = [];
  for (const [targetId, rows] of groups) {
    const create = rows.find(({ record }) => record.type === "SITE_DIARY_CREATE");
    const cachedWorkDate = isLocalId(targetId) ? null : (await serverDiaryVersion(db, projectId, targetId))?.workDate ?? null;
    const fields: DiaryFields = {};
    for (const { record, body } of rows) if (record.type === "SITE_DIARY_UPDATE_DRAFT") Object.assign(fields, body.payload);
    const submit = rows.find(({ record }) => record.type === "SITE_DIARY_SUBMIT");
    const problem = rows.find(({ record }) => record.state === "FAILED" || record.state === "NEEDS_REVIEW");
    const syncing = rows.some(({ record }) => record.state === "SYNCING");
    views.push({
      targetId,
      localOnly: isLocalId(targetId),
      projectId,
      companyId: rows[0]!.record.companyId,
      workDate: (create?.body.payload.workDate as string | undefined) ?? cachedWorkDate,
      fields,
      entries: rows.filter(({ record }) => record.type === "SITE_DIARY_ADD_ENTRY").map(({ record, body }) => ({ mutationId: record.id, section: body.payload.section as DiaryEntrySection, input: body.payload.input as Record<string, unknown>, state: record.state })),
      photos: rows.filter(({ record }) => record.type === "ATTACHMENT_CREATE").map(({ record, body }) => {
        const file = files.get(record.id);
        return { fileId: String(body.payload.fileId), mutationId: record.id, name: file?.body.name ?? body.label, state: record.state, fileState: file?.record.state ?? "PENDING", progress: file?.record.progress ?? 0, message: file?.body.errorMessage ?? body.errorMessage };
      }),
      submission: { queued: Boolean(submit), mutationId: submit?.record.id ?? null, state: submit?.record.state ?? null },
      syncState: problem ? (problem.record.state === "NEEDS_REVIEW" ? "CONFLICT" : "FAILED") : syncing ? "SYNCING" : isLocalId(targetId) ? "LOCAL_ONLY" : "PENDING",
      attention: problem ? { mutationId: problem.record.id, state: problem.record.state, message: problem.body.errorMessage ?? null, label: problem.body.label } : null,
    });
  }
  return views;
}

export const isVersionedChange = (type: MutationRecord["type"]): boolean => VERSIONED_TYPES.has(type);
