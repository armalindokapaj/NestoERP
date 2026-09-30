import { QUEUEABLE_TASK_COMMANDS, type QueueableTaskCommand } from "@/lib/core/sync/protocol";

import type { OfflineDatabase } from "../database";
import { enqueue, unsettledFor } from "../queue";
import type { MutationRecord } from "../types";

/**
 * Tasks offline (MOB-09 §44-§48).
 *
 * Reading is free. Writing is narrow on purpose: a comment, and Start or
 * Complete through the task's own commands. Claiming needs the server, because
 * two people must never both believe they hold the same task (§46).
 */

export const TASK_TARGET = "Task";

export type OfflineTask = {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "ARCHIVED";
  version: number;
  assignee: { memberId: string; fullName?: string } | null;
  dueDate: string | null;
  project: { id: string; name: string; code: string } | null;
  priority: string;
};

export const CLAIM_ONLINE_MESSAGE = "Connect to the internet to claim this task.";

const PERMISSION: Record<QueueableTaskCommand, string> = { start: "task.status.update", complete: "task.complete" };
const FROM: Record<QueueableTaskCommand, OfflineTask["status"][]> = { start: ["TODO", "BLOCKED"], complete: ["TODO", "IN_PROGRESS", "BLOCKED"] };

/** Why a command cannot be queued from this copy of the task, or null when it can. */
export function queueBlock(task: OfflineTask, command: QueueableTaskCommand | string, permissions: readonly string[]): string | null {
  if (command === "claim") return CLAIM_ONLINE_MESSAGE;
  if (!(QUEUEABLE_TASK_COMMANDS as readonly string[]).includes(command)) return "Connect to the internet to do this.";
  const known = command as QueueableTaskCommand;
  if (!permissions.includes(PERMISSION[known])) return "You do not have permission to do this.";
  if (!FROM[known].includes(task.status)) return "This task is not in a state where that can be done.";
  return null;
}

export async function queueTaskCommand(db: OfflineDatabase, input: { task: OfflineTask; command: QueueableTaskCommand; companyId: string; permissions: readonly string[] }): Promise<string> {
  const reason = queueBlock(input.task, input.command, input.permissions);
  if (reason) throw new Error(reason);
  // Tapping twice is one request, not two (§31).
  for (const row of await unsettledFor(db, input.task.id, ["TASK_ALLOWED_UPDATE"])) {
    if (row.state !== "PENDING" && row.state !== "SYNCING") continue;
    const stored = await db.getMutation(row.id);
    if (stored?.body.payload.command === input.command) return row.id;
  }
  const label = input.command === "complete" ? `Complete task · ${input.task.title}` : `Start task · ${input.task.title}`;
  const record = await enqueue(db, {
    type: "TASK_ALLOWED_UPDATE",
    companyId: input.companyId,
    projectId: input.task.project?.id ?? null,
    targetType: TASK_TARGET,
    targetId: input.task.id,
    label,
    payload: { command: input.command },
    expectedVersion: input.task.version,
  });
  return record.id;
}

export async function queueTaskComment(db: OfflineDatabase, input: { task: Pick<OfflineTask, "id" | "title" | "project">; companyId: string; body: string }): Promise<string> {
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body) throw new Error("Write a comment first.");
  if (body.length > 5000) throw new Error("Keep the comment under 5,000 characters.");
  const record = await enqueue(db, {
    type: "TASK_COMMENT_CREATE",
    companyId: input.companyId,
    projectId: input.task.project?.id ?? null,
    targetType: TASK_TARGET,
    targetId: input.task.id,
    label: `Task comment · ${input.task.title}`,
    payload: { body },
  });
  return record.id;
}

export type PendingTaskChange = { mutationId: string; kind: "comment" | "start" | "complete"; body: string | null; state: MutationRecord["state"]; message: string | null };

/** What is waiting to sync on a task, to show beside it — "Completion waiting to sync", a comment marked "Waiting to sync" (§47, §48). */
export async function pendingTaskChanges(db: OfflineDatabase, taskId: string): Promise<PendingTaskChange[]> {
  const rows = (await db.listMutations()).filter(({ record }) => record.targetId === taskId && record.targetType === TASK_TARGET);
  return rows.map(({ record, body }) => ({
    mutationId: record.id,
    kind: record.type === "TASK_COMMENT_CREATE" ? "comment" : (body.payload.command as "start" | "complete"),
    body: record.type === "TASK_COMMENT_CREATE" ? String(body.payload.body) : null,
    state: record.state,
    message: body.errorMessage ?? null,
  }));
}
