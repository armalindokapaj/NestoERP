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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const [blocking, setBlocking] = React.useState(false);
  const [blockReason, setBlockReason] = React.useState("");
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const { capabilities: may, status } = task;
  const archived = task.archivedAt !== null || status === "ARCHIVED";

  function run(
    action: "start" | "block" | "complete" | "reopen",
    successMessage: string,
    reason = "",
  ) {
    startTransition(async () => {
      const result = await setTaskStatusAction(task.id, action, "TODO", reason);
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
                  setBlockReason("");
                  setBlockError(null);
                  setBlocking(true);
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

      <Dialog open={blocking} onOpenChange={setBlocking}>
        <DialogContent className="max-w-md">
          <DialogTitle>Mark this task blocked</DialogTitle>
          <DialogDescription>
            Say what is stopping the work. Everyone watching the task is told, with your reason.
          </DialogDescription>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (blockReason.trim().length < 3) {
                setBlockError("Say why the task is blocked.");
                return;
              }
              setBlocking(false);
              run("block", "Task marked blocked.", blockReason.trim());
            }}
          >
            <Label htmlFor="block-reason">Reason</Label>
            <Textarea
              id="block-reason"
              value={blockReason}
              maxLength={1000}
              autoFocus
              aria-invalid={Boolean(blockError)}
              aria-describedby={blockError ? "block-reason-error" : undefined}
              onChange={(event) => {
                setBlockReason(event.target.value);
                setBlockError(null);
              }}
            />
            {blockError ? (
              <p id="block-reason-error" role="alert" className="text-meta text-danger-strong">
                {blockError}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                Mark blocked
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
