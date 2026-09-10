"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Check,
  MoreHorizontal,
  PenLine,
  Play,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import {
  archiveTaskAction,
  restoreTaskAction,
  setTaskStatusAction,
} from "@/lib/actions/tasks";
import type { TaskDetailDTO } from "@/lib/modules/tasks/task.types";

/**
 * Task header actions (PRD #11 §55, §159).
 *
 * Explicit verbs — Start, Mark Blocked, Complete, Reopen — rather than a status
 * dropdown, because that is how the work is actually driven. Only actions this
 * user may perform are rendered: a permission they lack produces no control at
 * all, disabled or otherwise (PRD #11 §140, §159).
 *
 * Nothing is applied optimistically; the server confirms first (PRD #11 §248).
 */
export function TaskActions({ task }: { task: TaskDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const { capabilities: may, status } = task;
  const archived = task.archivedAt !== null || status === "ARCHIVED";

  function run(
    action: "start" | "block" | "complete" | "reopen",
    successMessage: string,
  ) {
    startTransition(async () => {
      const result = await setTaskStatusAction(task.id, action);
      if (result.ok) {
        toast({ title: successMessage });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  function archive() {
    startTransition(async () => {
      const result = await archiveTaskAction(task.id);
      setConfirming(false);
      if (result.ok) {
        toast({ title: "Task archived." });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  function restore() {
    startTransition(async () => {
      const result = await restoreTaskAction(task.id);
      if (result.ok) {
        toast({ title: "Task restored." });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  const canStart = may.canChangeStatus && (status === "TODO" || status === "BLOCKED");
  const canBlock = may.canChangeStatus && (status === "TODO" || status === "IN_PROGRESS");

  return (
    <>
      {archived && may.canRestore ? (
        <Button size="sm" onClick={restore} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? "Restoring…" : "Restore"}
        </Button>
      ) : null}

      {!archived && canStart ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("start", "Task started.")}
          disabled={pending}
        >
          <Play aria-hidden="true" />
          Start
        </Button>
      ) : null}

      {!archived && may.canComplete ? (
        <Button size="sm" onClick={() => run("complete", "Task completed.")} disabled={pending}>
          <Check aria-hidden="true" />
          Complete
        </Button>
      ) : null}

      {!archived && may.canReopen ? (
        <Button size="sm" onClick={() => run("reopen", "Task reopened.")} disabled={pending}>
          <RotateCcw aria-hidden="true" />
          Reopen
        </Button>
      ) : null}

      {!archived && may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/tasks/${task.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {!archived && (canBlock || may.canArchive) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More task actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canBlock ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  run("block", "Task marked blocked.");
                }}
              >
                <Ban />
                Mark blocked
              </DropdownMenuItem>
            ) : null}
            {may.canArchive ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming(true);
                }}
              >
                <Archive />
                Archive task
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive ${task.title}?`}
        description="The task will be removed from active task lists. Its history is kept, and restoring returns it to the status it has now."
        confirmLabel="Archive task"
        pending={pending}
        onConfirm={archive}
      />
    </>
  );
}
