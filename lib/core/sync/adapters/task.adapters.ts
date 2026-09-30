import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { createCommentSchema } from "@/lib/core/collaboration/collaboration.schema";
import { createComment } from "@/lib/core/collaboration/collaboration.service";
import { completeTask, getTask, startTask } from "@/lib/modules/tasks/task.service";

import { QUEUEABLE_TASK_COMMANDS } from "../protocol";
import type { SyncAdapter } from "./types";

const ENTITY = "Task";

function taskId(operation: { target: { entityId: string } | null }): string {
  if (!operation.target) throw new AccessError("VALIDATION_ERROR", "This change does not say which task it is for.", { code: "TARGET_REQUIRED" });
  return operation.target.entityId;
}

/** A comment is append-only: it coexists with any number of newer comments and has no version to conflict on (§75). */
export const taskCommentCreate: SyncAdapter = {
  type: "TASK_COMMENT_CREATE",
  requiresVersion: false,
  async run(context, operation) {
    const id = taskId(operation);
    const input = createCommentSchema.parse({ body: operation.payload.body, replyToId: operation.payload.replyToId });
    const comment = await createComment(context, "task", id, input, { clientOperationId: operation.operationId });
    return { entityType: "Comment", entityId: comment.id };
  },
};

const updatePayload = z.object({ command: z.enum(QUEUEABLE_TASK_COMMANDS) });

/**
 * Start or complete, through the task's own commands, with the version the
 * device saw. Whatever else happened to the task meanwhile comes back as a
 * conflict for the person to review (§76, §81).
 */
export const taskAllowedUpdate: SyncAdapter = {
  type: "TASK_ALLOWED_UPDATE",
  requiresVersion: true,
  async run(context, operation) {
    const id = taskId(operation);
    const { command } = updatePayload.parse(operation.payload);
    const input = { expectedVersion: operation.expectedVersion };
    const response = command === "start" ? await startTask(context, id, input) : await completeTask(context, id, input);
    return { entityType: ENTITY, entityId: id, serverVersion: response.meta.version };
  },
  async describeCurrent(context, operation) {
    if (!operation.target) return undefined;
    try {
      const task = await getTask(context, operation.target.entityId);
      return { status: task.status, version: task.version };
    } catch {
      return undefined;
    }
  },
};
