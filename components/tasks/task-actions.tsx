"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
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
import { UnsavedValue } from "@/components/unsaved/unsaved-value";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { taskCommandAction, type ActionResult, type TaskCommandName } from "@/lib/actions/tasks";
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
 * Every command names the version this page shows (AUD-02 §3). When the task
 * has moved on, the page is refreshed to its latest state and the person
 * chooses again — a command is never re-sent against a version they have not
 * seen (§7).
 */
const UNCONFIRMED = "We couldn't confirm whether this change was saved. Check the latest task before trying again.";
const CHANGED = "This task changed since you opened it. Its latest state is shown now; choose again.";

export function TaskActions({ task }: { task: TaskDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [blocking, setBlocking] = React.useState(false);
  // A dialog chosen from the menu opens once the menu has finished closing: a
  // menu still animating out is the top layer and would take the dialog's
  // first Escape, and its focus return would pull focus off the dialog.
  const [menuOpen, setMenuOpen] = React.useState(false);
  const chosenDialog = React.useRef<"block" | "archive" | null>(null);
  // The version the reason dialog was opened on: a refresh behind it does not
  // quietly move the command to a state the person has not looked at.
  const [blockVersion, setBlockVersion] = React.useState(task.version);
  const [blockReason, setBlockReason] = React.useState("");
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const { capabilities: may, status } = task;
  const archived = task.archivedAt !== null || status === "ARCHIVED";

  /**
   * Sends one command. Answers whether it committed, so a dialog knows to
   * close; a refusal is reported and the page refreshed where the task moved.
   */
  function send(
    command: TaskCommandName,
    successMessage: string,
    input: { expectedVersion: number; reason?: string },
    onRefused?: (message: string) => void,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: ActionResult;
        try {
          result = await taskCommandAction(task.id, command, input);
        } catch {
          // The request may or may not have reached the server: say so, show
          // the latest task, and let the person decide (AUD-02 §7).
          (onRefused ?? ((message: string) => toast({ title: message, tone: "warning" })))(UNCONFIRMED);
          router.refresh();
          resolve(false);
          return;
        }
        if (result.ok) {
          if (result.redirectTo) {
            toast({ title: `${successMessage} You no longer have access to this task.`, tone: "success" });
            router.push(result.redirectTo);
          } else {
            toast({ title: successMessage, tone: "success" });
            router.refresh();
          }
          resolve(true);
          return;
        }
        const moved = result.code === "TASK_VERSION_CONFLICT" || result.code === "TASK_STATE_CONFLICT";
        (onRefused ?? ((message: string) => toast({ title: message, tone: "danger" })))(moved ? CHANGED : result.error);
        if (moved) router.refresh();
        resolve(false);
      });
    });
  }

  function run(command: "start" | "complete" | "reopen", successMessage: string) {
    void send(command, successMessage, { expectedVersion: task.version });
  }

  function archive() {
    void send("archive", "Task archived.", { expectedVersion: task.version }).then(() => setConfirming(false));
  }

  function restore() {
    void send("restore", "Task restored.", { expectedVersion: task.version });
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
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More task actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              const chosen = chosenDialog.current;
              if (!chosen) return;
              chosenDialog.current = null;
              // The dialog takes focus itself.
              event.preventDefault();
              if (chosen === "block") setBlocking(true);
              else setConfirming(true);
            }}
          >
            {canBlock ? (
              <DropdownMenuItem
                onSelect={() => {
                  // A reason typed before a refused attempt is kept.
                  setBlockError(null);
                  setBlockVersion(task.version);
                  chosenDialog.current = "block";
                }}
              >
                <Ban />
                Mark blocked
              </DropdownMenuItem>
            ) : null}
            {may.canArchive ? (
              <DropdownMenuItem
                onSelect={() => {
                  chosenDialog.current = "archive";
                }}
              >
                <Archive />
                Archive task
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog
        open={blocking}
        onOpenChange={(open) => {
          setBlocking(open);
          // A close reaches here only once nothing is unsaved or the person
          // chose Discard (AUD-03): the reason goes with it. A refused attempt
          // keeps the dialog, and its reason, open (AUD-02).
          if (!open) setBlockReason("");
        }}
      >
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
              setBlockError(null);
              // The dialog stays open, with the reason, until the server has
              // confirmed; a refusal is shown inside it (AUD-02 §7).
              void send("block", "Task marked blocked.", { expectedVersion: blockVersion, reason: blockReason.trim() }, setBlockError).then(
                (committed) => {
                  if (committed) {
                    setBlocking(false);
                    setBlockReason("");
                  }
                },
              );
            }}
          >
            {/* A typed reason is unsaved input; marking blocked is the only way it is kept (AUD-03 §4). */}
            <UnsavedValue module="tasks" saveKind="none" workflow="Mark blocked" label="The reason this task is blocked" dirty={blockReason !== ""} saving={pending} />
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
                {pending ? "Saving…" : "Mark blocked"}
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
