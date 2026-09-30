"use client";

import * as React from "react";
import { CheckCircle2, Loader2, MessageSquarePlus, Play } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CLAIM_ONLINE_MESSAGE, pendingTaskChanges, queueBlock, queueTaskCommand, queueTaskComment, type OfflineTask } from "@/lib/offline/modules/tasks";
import { offlineRuntime } from "@/lib/offline/runtime";

import { useOffline } from "../use-offline";
import { useOfflineQuery } from "./use-offline-data";

type CachedComments = { taskId: string; comments: Array<{ id: string; author: { fullName: string }; createdAt: string; archived: boolean; segments: Array<{ type: string; text?: string; name?: string }> | null }>; canComment: boolean };

/**
 * A downloaded task (MOB-09 §44-§48). It reads freely. It can be started or
 * completed and commented on, through the task's own commands; claiming says it
 * needs a connection. What is waiting to sync is shown beside the task, never
 * folded into its status.
 */
export function TaskView({ projectId, taskId, locked }: { projectId: string | null; taskId: string; locked: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const data = useOfflineQuery(
    async (db) => {
      const projects = projectId ? [projectId] : (await db.listProjects()).map(({ record }) => record.projectId);
      for (const id of projects) {
        const hit = await db.getCache<OfflineTask>(id, "tasks", taskId);
        if (hit) {
          const comments = await db.getCache<CachedComments>(id, "comments", taskId);
          return { task: hit.data, projectId: id, companyId: hit.record.companyId, comments: comments?.data ?? null, pending: await pendingTaskChanges(db, taskId) };
        }
      }
      return { task: null, projectId: null, companyId: null, comments: null, pending: [] };
    },
    [taskId, projectId],
  );

  if (!data) return <Loader2 className="mx-auto size-5 animate-spin text-fg-muted" aria-label={t("sync.syncing")} />;
  if (!data.task || locked) return <p className="text-body text-fg-muted">{t("tasks.notFound")}</p>;
  const { task, companyId } = data;
  const permissions = state.authorization?.permissions ?? [];
  const runtime = offlineRuntime();
  const pendingCommand = data.pending.find((entry) => entry.kind !== "comment" && (entry.state === "PENDING" || entry.state === "SYNCING" || entry.state === "BLOCKED"));

  const command = async (name: "start" | "complete") => {
    setError(null);
    try {
      await runtime.run((db) => queueTaskCommand(db, { task, command: name, companyId: companyId!, permissions }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("tasks.needsConnection"));
    }
  };

  const postComment = async () => {
    setError(null);
    try {
      await runtime.run((db) => queueTaskComment(db, { task, companyId: companyId!, body: comment }));
      setComment("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("tasks.needsConnection"));
    }
  };

  const startBlock = queueBlock(task, "start", permissions);
  const completeBlock = queueBlock(task, "complete", permissions);
  const threadComments = data.comments?.comments.filter((entry) => !entry.archived) ?? [];
  const pendingComments = data.pending.filter((entry) => entry.kind === "comment");

  return (
    <div className="space-y-4" data-testid="task-view">
      <div className="space-y-1">
        <h2 className="text-h2 font-semibold">{task.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" data-testid="task-status">{t(`tasks.status.${task.status}` as never)}</Badge>
          {pendingCommand ? (
            <Badge tone={pendingCommand.state === "SYNCING" ? "info" : "warning"} data-testid="task-pending">
              {pendingCommand.kind === "complete" ? t("tasks.completionWaiting") : t("tasks.startWaiting")}
            </Badge>
          ) : null}
          <span className="text-body text-fg-muted">{task.dueDate ? t("tasks.due", { date: task.dueDate.slice(0, 10) }) : t("tasks.noDue")}</span>
          <span className="text-body text-fg-muted">{task.assignee ? t("tasks.assignee", { name: task.assignee.fullName ?? "" }) : t("tasks.unassigned")}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => command("start")} disabled={Boolean(startBlock) || Boolean(pendingCommand)} data-testid="task-start">
          <Play aria-hidden /> {t("tasks.start")}
        </Button>
        <Button onClick={() => command("complete")} disabled={Boolean(completeBlock) || Boolean(pendingCommand)} data-testid="task-complete">
          <CheckCircle2 aria-hidden /> {t("tasks.complete")}
        </Button>
        {!task.assignee ? (
          <Button variant="secondary" disabled={!state.online} data-testid="task-claim" title={state.online ? undefined : CLAIM_ONLINE_MESSAGE}>
            {t("tasks.claim")}
          </Button>
        ) : null}
      </div>
      {!state.online && !task.assignee ? <p className="text-body text-fg-muted">{t("tasks.claimOnline")}</p> : null}
      {error ? <p role="alert" className="text-body text-danger-strong">{error}</p> : null}

      <section className="space-y-2">
        <h3 className="font-semibold">{t("tasks.comments")}</h3>
        {threadComments.length === 0 && pendingComments.length === 0 ? <p className="text-body text-fg-muted">{t("tasks.noComments")}</p> : null}
        <ul className="space-y-2">
          {threadComments.map((entry) => (
            <li key={entry.id}>
              <Card compact>
                <p className="text-micro text-fg-muted">{entry.author.fullName}</p>
                <p className="whitespace-pre-wrap text-body">{entry.segments?.map((segment) => (segment.type === "mention" ? `@${segment.name}` : segment.text)).join("") ?? ""}</p>
              </Card>
            </li>
          ))}
          {pendingComments.map((entry) => (
            <li key={entry.mutationId} data-testid="task-pending-comment">
              <Card compact>
                <p className="text-micro text-fg-muted">{state.authorization?.user?.fullName}</p>
                <p className="whitespace-pre-wrap text-body">{entry.body}</p>
                <Badge tone={entry.state === "FAILED" ? "danger" : "warning"}>{entry.state === "FAILED" ? t("tasks.syncFailed") : t("tasks.waitingToSync")}</Badge>
              </Card>
            </li>
          ))}
        </ul>
        {permissions.includes("collaboration.comment.create") ? (
          <div className="space-y-2">
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("tasks.commentPlaceholder")} rows={2} aria-label={t("tasks.commentPlaceholder")} data-testid="task-comment-input" />
            <Button variant="secondary" onClick={postComment} disabled={!comment.trim()} data-testid="task-comment-add">
              <MessageSquarePlus aria-hidden /> {t("tasks.addComment")}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
