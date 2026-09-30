"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Check,
  HandHelping,
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
import { useTranslations } from "@/components/i18n/i18n-provider";
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

type StatusCommand = "start" | "complete" | "reopen";
type Verb = {
  command: StatusCommand;
  label: string;
  pendingLabel: string;
  done: string;
  icon: typeof Play;
  variant: "primary" | "secondary";
};

export function TaskActions({ task }: { task: TaskDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("tasks");
  const UNCONFIRMED = t("actions.unconfirmed");
  const CHANGED = t("actions.changed");
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
  // Which verb is in flight, so the pressed button says so (AUD-04 §6, MW-15).
  const [running, setRunning] = React.useState<TaskCommandName | null>(null);
  // A second tap lands before the disabled state renders: it is dropped here,
  // never sent as a second command against the same version (MW-15).
  const inFlight = React.useRef(false);

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
    if (inFlight.current) return Promise.resolve(false);
    inFlight.current = true;
    setRunning(command);
    return new Promise((resolve) => {
      const settle = (committed: boolean) => {
        inFlight.current = false;
        setRunning(null);
        resolve(committed);
      };
      startTransition(async () => {
        let result: ActionResult;
        try {
          result = await taskCommandAction(task.id, command, input);
        } catch {
          // The request may or may not have reached the server: say so, show
          // the latest task, and let the person decide (AUD-02 §7).
          (onRefused ?? ((message: string) => toast({ title: message, tone: "warning" })))(UNCONFIRMED);
          router.refresh();
          settle(false);
          return;
        }
        if (result.ok) {
          if (result.redirectTo) {
            toast({ title: t("actions.lostAccess", { message: successMessage }), tone: "success" });
            router.push(result.redirectTo);
          } else {
            toast({ title: successMessage, tone: "success" });
            router.refresh();
          }
          settle(true);
          return;
        }
        const moved = result.code === "TASK_VERSION_CONFLICT" || result.code === "TASK_STATE_CONFLICT";
        // A lost claim says who won rather than "changed" (MOB-06 §23).
        const claimLost = command === "claim" && result.code === "TASK_STATE_CONFLICT";
        (onRefused ?? ((message: string) => toast({ title: message, tone: "danger" })))(moved && !claimLost ? CHANGED : result.error);
        if (moved) router.refresh();
        settle(false);
      });
    });
  }

  function run(command: StatusCommand, successMessage: string) {
    void send(command, successMessage, { expectedVersion: task.version });
  }

  function archive() {
    void send("archive", t("actions.archivedDone"), { expectedVersion: task.version }).then(() => setConfirming(false));
  }

  function restore() {
    void send("restore", t("actions.restoredDone"), { expectedVersion: task.version });
  }

  const canStart = may.canChangeStatus && (status === "TODO" || status === "BLOCKED");
  const canBlock = may.canChangeStatus && (status === "TODO" || status === "IN_PROGRESS");

  /*
   * On a phone the header keeps one verb in view — the next step for this
   * task — and every other action this person may take moves into the More
   * menu (AUD-04 §4, MW-11). The same controls render at every width and CSS
   * decides where each one shows: nothing is mounted twice, nothing depends
   * on guessing the device, and no permitted action disappears.
   */
  const verbs: Verb[] = archived
    ? []
    : [
        ...(canStart ? [{ command: "start" as const, label: t("actions.start"), pendingLabel: t("actions.starting"), done: t("actions.started"), icon: Play, variant: "secondary" as const }] : []),
        ...(may.canComplete ? [{ command: "complete" as const, label: t("actions.complete"), pendingLabel: t("actions.completing"), done: t("actions.completedDone"), icon: Check, variant: "primary" as const }] : []),
        ...(may.canReopen ? [{ command: "reopen" as const, label: t("actions.reopen"), pendingLabel: t("actions.reopening"), done: t("actions.reopened"), icon: RotateCcw, variant: "primary" as const }] : []),
      ];
  const secondary = verbs.slice(1);
  const canEdit = !archived && may.canEdit;
  // What only a phone finds in the menu; with nothing else in it, the menu is phone-only.
  const phoneOnlyItems = secondary.length > 0 || canEdit;
  const desktopItems = !archived && (canBlock || may.canArchive);

  return (
    <>
      {archived && may.canRestore ? (
        <Button size="sm" onClick={restore} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? t("actions.restoring") : t("actions.restore")}
        </Button>
      ) : null}

      {/* Claim sits beside the verbs, not among them: it never displaces Start or Complete in the phone header (MOB-06 §22). */}
      {!archived && may.canClaim ? (
        <Button variant="primary" size="sm" onClick={() => void send("claim", t("actions.claimed"), { expectedVersion: task.version })} disabled={pending} aria-busy={running === "claim" || undefined}>
          <HandHelping aria-hidden="true" />
          {running === "claim" ? t("actions.claiming") : t("actions.claim")}
        </Button>
      ) : null}

      {verbs.map((verb, index) => (
        <Button
          key={verb.command}
          variant={verb.variant}
          size="sm"
          // The first verb stays in view on a phone; the rest are in More there.
          className={index > 0 ? "max-sm:hidden" : undefined}
          onClick={() => run(verb.command, verb.done)}
          disabled={pending}
          aria-busy={running === verb.command || undefined}
        >
          <verb.icon aria-hidden="true" />
          {running === verb.command ? verb.pendingLabel : verb.label}
        </Button>
      ))}

      {canEdit ? (
        <Button asChild variant="secondary" size="sm" className="max-sm:hidden">
          <Link href={`/tasks/${task.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {phoneOnlyItems || desktopItems ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("actions.more")} className={desktopItems ? undefined : "sm:hidden"}>
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
            {/* Phone only: the verbs and Edit the header shows from 640px up (AUD-04 §4). */}
            {secondary.map((verb) => (
              <DropdownMenuItem key={verb.command} className="sm:hidden" disabled={pending} onSelect={() => run(verb.command, verb.done)}>
                <verb.icon />
                {verb.label}
              </DropdownMenuItem>
            ))}
            {canEdit ? (
              <DropdownMenuItem asChild className="sm:hidden">
                <Link href={`/tasks/${task.id}/edit`}>
                  <PenLine />
                  {t("actions.editTask")}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {!archived && canBlock ? (
              <DropdownMenuItem
                onSelect={() => {
                  // A reason typed before a refused attempt is kept.
                  setBlockError(null);
                  setBlockVersion(task.version);
                  chosenDialog.current = "block";
                }}
              >
                <Ban />
                {t("actions.markBlocked")}
              </DropdownMenuItem>
            ) : null}
            {!archived && may.canArchive ? (
              <DropdownMenuItem
                onSelect={() => {
                  chosenDialog.current = "archive";
                }}
              >
                <Archive />
                {t("actions.archiveTask")}
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
        {/* The primitive bounds the dialog to the viewport and scrolls it; the reason is kept short so it and the footer both fit above a phone keyboard in landscape (AUD-04 §6, MW-10). */}
        <DialogContent className="max-w-md">
          <DialogTitle>{t("actions.blockTitle")}</DialogTitle>
          <DialogDescription>
            {t("actions.blockDescription")}
          </DialogDescription>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (blockReason.trim().length < 3) {
                setBlockError(t("actions.blockReasonRequired"));
                return;
              }
              setBlockError(null);
              // The dialog stays open, with the reason, until the server has
              // confirmed; a refusal is shown inside it (AUD-02 §7).
              void send("block", t("actions.blockedDone"), { expectedVersion: blockVersion, reason: blockReason.trim() }, setBlockError).then(
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
            <Label htmlFor="block-reason">{t("actions.reason")}</Label>
            <Textarea
              id="block-reason"
              rows={3}
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
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? t("common.saving") : t("actions.markBlocked")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("actions.archiveConfirmTitle", { title: task.title })}
        description={t("actions.archiveConfirmDescription")}
        confirmLabel={t("actions.archiveTask")}
        pending={pending}
        onConfirm={archive}
      />
    </>
  );
}
