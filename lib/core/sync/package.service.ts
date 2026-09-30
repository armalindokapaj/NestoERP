import { createHash } from "node:crypto";

import type { UserContext } from "@/lib/context/types";
import { getThread } from "@/lib/core/collaboration/collaboration.service";
import { listDailyLogs, getDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { listQuerySchema as dailyLogListQuery } from "@/lib/modules/daily-logs/daily-log.schema";
import { projectDocumentsForOffline } from "@/lib/modules/documents/versions/offline.service";
import { listProjectUnits } from "@/lib/modules/project-structure/structure.service";
import { getProject } from "@/lib/modules/projects/project.service";
import { taskListQuerySchema } from "@/lib/modules/tasks/task.schema";
import { listTasks } from "@/lib/modules/tasks/task.service";

import { AccessError } from "@/lib/access/guards";
import { authorizationSnapshotFor, type AuthorizationSnapshot } from "./authorization.service";
import { SYNC_PROTOCOL_VERSION } from "./protocol";

/**
 * A Project's offline package, and the changes since a device last had it
 * (MOB-09 §9, §71, §72, §139).
 *
 * Everything is read through the ordinary services, in the caller's own scope,
 * so the package can only ever hold what the project page would have shown this
 * person. There is no cursor table and no device clock: a refresh sends the
 * device's known tokens, the server builds the current state and answers only
 * with what differs (§73).
 */

export const PACKAGE_KINDS = ["tasks", "units", "dailyLogs", "dailyLogDrafts", "documents", "comments"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];

export type KnownTokens = Partial<Record<PackageKind, Record<string, string>>>;

export type EntityDelta = { upserts: Array<{ id: string; token: string; data: unknown }>; removed: string[] };

export type ProjectPackage = {
  protocolVersion: number;
  serverTime: string;
  project: Awaited<ReturnType<typeof getProject>>;
  authorization: AuthorizationSnapshot;
  diary: { today: string | null; canCreate: boolean };
  entities: Record<PackageKind, EntityDelta>;
};

const TASK_LIMIT = 100;
const DRAFT_LIMIT = 10;
const COMMENT_TASKS = 20;
const COMMENTS_PER_TASK = 30;
const RECENT_LOG_DAYS = 14;

function tokenOf(data: unknown): string {
  return createHash("sha1").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}

function delta(known: Record<string, string> | undefined, current: Array<{ id: string; data: unknown }>): EntityDelta {
  const seen = new Set<string>();
  const upserts: EntityDelta["upserts"] = [];
  for (const entry of current) {
    seen.add(entry.id);
    const token = tokenOf(entry.data);
    if (known?.[entry.id] !== token) upserts.push({ id: entry.id, token, data: entry.data });
  }
  const removed = Object.keys(known ?? {}).filter((id) => !seen.has(id));
  return { upserts, removed };
}

function dayOffset(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function buildProjectPackage(context: UserContext, projectId: string, known: KnownTokens = {}): Promise<ProjectPackage> {
  // The project first: outside this person's scope it answers "not found", and the device treats that as access revoked (§58).
  const project = await getProject(context, projectId);
  // A policy that switched offline access off also stops new packages leaving the server (MOB-11 §73, §151).
  const authorization = await authorizationSnapshotFor(context);
  if (!authorization.offlineAllowed) throw new AccessError("FORBIDDEN", "Offline access is turned off by your organisation's security policy.");

  const tasksQuery = taskListQuerySchema.parse({ projectId, openOnly: true, limit: TASK_LIMIT, page: 1, sort: "due-asc" });
  const [tasks, units, logs, drafts, documents] = await Promise.all([
    listTasks(context, tasksQuery).then((r) => r.data).catch(() => []),
    listProjectUnits(context, projectId, { page: 1, limit: 100 }).then((r) => r.items).catch(() => []),
    listDailyLogs(context, dailyLogListQuery.parse({ projectId, from: dayOffset(RECENT_LOG_DAYS), pageSize: 50 })).catch(() => null),
    listDailyLogs(context, dailyLogListQuery.parse({ projectId, status: "DRAFT", pageSize: DRAFT_LIMIT })).catch(() => null),
    projectDocumentsForOffline(context, projectId).catch(() => []),
  ]);

  // Drafts the reader is writing can be edited offline, so they come whole; the rest are summaries.
  const draftRows = await Promise.all(
    (drafts?.items ?? []).filter((item) => item.author?.memberId === context.membershipId).map((item) => getDailyLog(context, item.id).catch(() => null)),
  );

  // The discussion of the tasks the person is assigned to, where reading it offline is useful (§44).
  const mine = tasks.filter((task) => task.assignee && task.assignee.memberId === context.membershipId).slice(0, COMMENT_TASKS);
  const threads = await Promise.all(
    mine.map(async (task) => {
      const thread = await getThread(context, "task", task.id, { limit: COMMENTS_PER_TASK }).catch(() => null);
      return thread ? { id: task.id, data: { taskId: task.id, comments: thread.comments, canComment: thread.capabilities.canComment } } : null;
    }),
  );

  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    serverTime: new Date().toISOString(),
    project,
    authorization,
    diary: { today: logs?.today?.date ?? null, canCreate: logs?.today?.canCreate ?? false },
    entities: {
      tasks: delta(known.tasks, tasks.map((task) => ({ id: task.id, data: task }))),
      units: delta(known.units, units.map((unit) => ({ id: unit.id, data: unit }))),
      dailyLogs: delta(known.dailyLogs, (logs?.items ?? []).map((item) => ({ id: item.id, data: item }))),
      dailyLogDrafts: delta(known.dailyLogDrafts, draftRows.filter((row) => row !== null).map((row) => ({ id: row.id, data: row }))),
      documents: delta(known.documents, documents.map((doc) => ({ id: doc.documentId, data: doc }))),
      comments: delta(known.comments, threads.filter((entry) => entry !== null)),
    },
  };
}
