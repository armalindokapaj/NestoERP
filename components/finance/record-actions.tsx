"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import {
  Archive,
  ArchiveRestore,
  Ban,
  CheckCheck,
  MoreHorizontal,
  PenLine,
  Send,
  SendHorizontal,
  ThumbsDown,
  ThumbsUp,
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
import type { FinanceActionResult } from "@/lib/actions/finance";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { RejectDialog } from "./reject-dialog";

/**
 * Header actions for a finance record (PRD #15 §305, §306).
 *
 * One component for all four record types, because the workflow is the same
 * shape everywhere: edit while it is a draft, submit, approve or reject, then
 * the type's own final step. What differs is which capabilities the server
 * granted — and those are hints, not security: each action re-checks
 * authorisation (PRD #15 §148).
 */
export type FinanceRecordKind = "invoice" | "expense" | "budget" | "commitment";

export function FinanceRecordActions({
  kind,
  label,
  capabilities,
  lifecycle,
  reject,
  editHref,
}: {
  kind: FinanceRecordKind;
  label: string;
  capabilities: RecordCapabilities;
  lifecycle: (action: string, note?: string) => Promise<FinanceActionResult>;
  reject: (reason: string) => Promise<FinanceActionResult>;
  editHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<null | "cancel" | "archive" | "close">(null);
  const [rejecting, setRejecting] = React.useState(false);
  /** The step on its way: its button says so, and no second step starts (AUD-04 §6, MW-15). */
  const [running, setRunning] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  function run(action: string, success: string) {
    // A second tap before the first re-render is the same request, not another one.
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(action);
    startTransition(async () => {
      try {
        const result = await lifecycle(action);
        setConfirming(null);
        if (result.ok) {
          toast({ title: success, tone: "success" });
          router.refresh();
        } else {
          toast({ title: result.error, tone: "danger" });
        }
      } catch {
        // No answer: the step may or may not have happened. Say so, never
        // retry it, and show the record as it now stands (AUD-03 §6, AUD-04 §6).
        setConfirming(null);
        toast({ title: OUTCOME_COPY.unknown, tone: "danger" });
        router.refresh();
      } finally {
        inFlight.current = false;
        setRunning(null);
      }
    });
  }

  const busy = pending || running !== null;
  const buttonText = (action: string, idle: string, working: string) => (running === action ? working : idle);

  return (
    <>
      {capabilities.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={editHref}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {capabilities.canSubmit ? (
        <Button size="sm" onClick={() => run("submit", "Submitted for approval.")} disabled={busy} aria-busy={running === "submit" || undefined}>
          <Send aria-hidden="true" />
          {buttonText("submit", "Submit for approval", "Submitting…")}
        </Button>
      ) : null}

      {capabilities.canApprove ? (
        <Button size="sm" onClick={() => run("approve", `${LABELS[kind]} approved.`)} disabled={busy} aria-busy={running === "approve" || undefined}>
          <ThumbsUp aria-hidden="true" />
          {buttonText("approve", "Approve", "Approving…")}
        </Button>
      ) : null}

      {capabilities.canReject ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRejecting(true)}
          disabled={busy}
        >
          <ThumbsDown aria-hidden="true" />
          Reject
        </Button>
      ) : null}

      {capabilities.canMarkSent ? (
        <Button size="sm" onClick={() => run("mark-sent", "Marked as sent.")} disabled={busy} aria-busy={running === "mark-sent" || undefined}>
          <SendHorizontal aria-hidden="true" />
          {buttonText("mark-sent", "Mark as sent", "Marking as sent…")}
        </Button>
      ) : null}

      {capabilities.canRestore ? (
        <Button size="sm" onClick={() => run("restore", `${LABELS[kind]} restored.`)} disabled={busy} aria-busy={running === "restore" || undefined}>
          <ArchiveRestore aria-hidden="true" />
          {buttonText("restore", "Restore", "Restoring…")}
        </Button>
      ) : null}

      {capabilities.canRevise ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`${editHref.replace(/\/edit$/, "")}/revise`}>
            <CheckCheck aria-hidden="true" />
            Create revision
          </Link>
        </Button>
      ) : null}

      {capabilities.canClose || capabilities.canCancel || capabilities.canArchive ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${label}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {capabilities.canClose ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming("close");
                }}
              >
                <CheckCheck />
                Close commitment
              </DropdownMenuItem>
            ) : null}
            {capabilities.canCancel ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming("cancel");
                }}
              >
                <Ban />
                Cancel {kind}
              </DropdownMenuItem>
            ) : null}
            {capabilities.canArchive ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming("archive");
                }}
              >
                <Archive />
                Archive {kind}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirmTitle(confirming, kind, label)}
        description={confirmBody(confirming, kind)}
        confirmLabel={
          confirming === "close" ? "Close" : confirming === "cancel" ? "Cancel it" : "Archive"
        }
        pending={busy}
        onConfirm={() => {
          if (confirming === "close") run("close", "Commitment closed.");
          else if (confirming === "cancel") run("cancel", `${LABELS[kind]} cancelled.`);
          else if (confirming === "archive") run("archive", `${LABELS[kind]} archived.`);
        }}
      />

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${label}?`}
        onReject={async (reason) => {
          const result = await reject(reason);
          if (result.ok) {
            toast({ title: `${LABELS[kind]} rejected.` });
            setRejecting(false);
            router.refresh();
          } else {
            toast({ title: result.error, tone: "danger" });
          }
          return result.ok;
        }}
      />
    </>
  );
}

const LABELS: Record<FinanceRecordKind, string> = {
  invoice: "Invoice",
  expense: "Expense",
  budget: "Budget",
  commitment: "Commitment",
};

function confirmTitle(
  action: "cancel" | "archive" | "close" | null,
  kind: FinanceRecordKind,
  label: string,
): string {
  if (action === "close") return `Close ${label}?`;
  if (action === "cancel") return `Cancel ${label}?`;
  return `Archive ${label}?`;
}

function confirmBody(
  action: "cancel" | "archive" | "close" | null,
  kind: FinanceRecordKind,
): string {
  if (action === "close") {
    return "The commitment stops counting toward forecast cost. It stays visible, with its history.";
  }
  if (action === "cancel") {
    return kind === "invoice"
      ? "The invoice will no longer stand. It stays visible and cannot take payments. This is refused if any payment has been recorded against it."
      : "The record will no longer stand, and stops counting toward cost. It stays visible with its history.";
  }
  return "It is removed from active lists. Nothing is deleted, and it can be restored to the status it holds now.";
}
