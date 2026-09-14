"use client";

import * as React from "react";
import { Check, CornerUpLeft, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalDecision, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "./approval-ui";

/**
 * The decision bar and its dialogs (PRD #41 §82-§85, §100, §111-§113,
 * §202-§208, §224).
 *
 * Approve is one press — with a note if the approver wants one — except for a
 * record its module flags as high-risk, which asks once more and names what is
 * being approved. Reject and Return always need a reason, and say so out loud
 * if it is missing. While a decision is in flight every button is disabled; the
 * item only changes once the server has answered. There are no single-key
 * shortcuts for any of it.
 */

const NOTE_LIMIT = 5000;

export function DecisionBar({
  item,
  pending,
  onDecide,
  className,
}: {
  item: UnifiedApprovalItem;
  pending: ApprovalDecision | null;
  onDecide: (decision: ApprovalDecision, note: string | null) => Promise<boolean>;
  className?: string;
}) {
  const [dialog, setDialog] = React.useState<ApprovalDecision | null>(null);
  const [note, setNote] = React.useState("");
  const [noteOpen, setNoteOpen] = React.useState(false);
  const busy = pending !== null;
  const any = item.canApprove || item.canReject || item.canReturn;
  const noun = item.sourceLabel.toLowerCase();

  React.useEffect(() => {
    setNote("");
    setNoteOpen(false);
    setDialog(null);
  }, [item.id]);

  if (!any) {
    return (
      <div className={cn("border-t border-line bg-surface px-5 py-3.5", className)} data-testid="decision-bar">
        <p className="text-table text-fg-muted">{item.status === "PENDING" ? (item.blockedReason ?? "Nothing for you to decide here.") : "This approval has been decided."}</p>
      </div>
    );
  }

  async function approve() {
    if (item.requiresStrongConfirmation) {
      setDialog("APPROVE");
      return;
    }
    if (await onDecide("APPROVE", note.trim() || null)) {
      setNote("");
      setNoteOpen(false);
    }
  }

  return (
    <div className={cn("border-t border-line bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:px-5", className)} data-testid="decision-bar">
      {noteOpen && item.canApprove ? (
        <div className="mb-3 space-y-1.5">
          <Label htmlFor={`approve-note-${item.id}`}>Note with your approval (optional)</Label>
          <Textarea
            id={`approve-note-${item.id}`}
            rows={2}
            maxLength={NOTE_LIMIT}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything the requester should know"
          />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {item.canApprove && !noteOpen ? (
          <Button type="button" variant="ghost" size="sm" className="mr-auto hidden sm:inline-flex" onClick={() => setNoteOpen(true)} disabled={busy}>
            Add note
          </Button>
        ) : (
          <span className="mr-auto" />
        )}
        {item.canReturn ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="flex-1 sm:flex-none"
            disabled={busy}
            onClick={() => setDialog("RETURN")}
            aria-label={`Return this ${noun} for revision`}
          >
            {pending === "RETURN" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <CornerUpLeft aria-hidden="true" />}
            Return
          </Button>
        ) : null}
        {item.canReject ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="flex-1 text-danger-strong hover:text-danger-strong sm:flex-none"
            disabled={busy}
            onClick={() => setDialog("REJECT")}
            aria-label={`Reject this ${noun}`}
          >
            {pending === "REJECT" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <X aria-hidden="true" />}
            Reject
          </Button>
        ) : null}
        {item.canApprove ? (
          <Button type="button" size="lg" className="flex-1 sm:flex-none sm:min-w-32" disabled={busy} onClick={() => void approve()} aria-label={`Approve this ${noun}`}>
            {pending === "APPROVE" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
            {item.totalSteps && item.currentStep && item.currentStep < item.totalSteps ? `Approve step ${item.currentStep}` : "Approve"}
          </Button>
        ) : null}
      </div>

      <ReasonDialog
        open={dialog === "REJECT" || dialog === "RETURN"}
        decision={dialog === "RETURN" ? "RETURN" : "REJECT"}
        item={item}
        pending={pending}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        onSubmit={async (reason) => {
          if (await onDecide(dialog === "RETURN" ? "RETURN" : "REJECT", reason)) setDialog(null);
        }}
      />
      <StrongApproveDialog
        open={dialog === "APPROVE"}
        item={item}
        pending={pending === "APPROVE"}
        initialNote={note}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        onConfirm={async (confirmedNote) => {
          if (await onDecide("APPROVE", confirmedNote)) {
            setDialog(null);
            setNote("");
            setNoteOpen(false);
          }
        }}
      />
    </div>
  );
}

function ReasonDialog({
  open,
  decision,
  item,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  decision: "REJECT" | "RETURN";
  item: UnifiedApprovalItem;
  pending: ApprovalDecision | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const reject = decision === "REJECT";
  const busy = pending !== null;

  return (
    <Dialog open={open} onOpenChange={(value) => (busy ? null : onOpenChange(value))}>
      <DialogContent>
        <DialogTitle>{reject ? `Reject ${item.reference ?? "this request"}?` : `Return ${item.reference ?? "this request"} for revision?`}</DialogTitle>
        <DialogDescription>
          {reject
            ? `${item.requester.name} is told it was rejected, with your reason. ${item.sourceLabel}s follow their own rules once rejected.`
            : `It goes back to ${item.requester.name} to change and submit again. Your reason tells them what to change.`}
        </DialogDescription>
        <form
          className="mt-4 space-y-1.5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reason.trim()) {
              setError(reject ? "Give a reason for rejecting it." : "Say what needs to change.");
              return;
            }
            await onSubmit(reason.trim());
          }}
        >
          <Label htmlFor={`${id}-reason`}>{reject ? "Reason for rejecting" : "What needs to change"}</Label>
          <Textarea
            id={`${id}-reason`}
            rows={4}
            autoFocus
            maxLength={NOTE_LIMIT}
            value={reason}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-count`}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError(null);
            }}
          />
          <div className="flex items-start justify-between gap-3">
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-meta font-medium text-danger-strong">
                {error}
              </p>
            ) : (
              <span />
            )}
            <span id={`${id}-count`} className="shrink-0 text-meta tabular-nums text-fg-subtle">
              {reason.length.toLocaleString("en-GB")} / 5,000
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={reject ? "danger" : "primary"} disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {reject ? "Reject" : "Return for revision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StrongApproveDialog({
  open,
  item,
  pending,
  initialNote,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  item: UnifiedApprovalItem;
  pending: boolean;
  initialNote: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string | null) => Promise<void>;
}) {
  const [note, setNote] = React.useState(initialNote);
  const id = React.useId();
  React.useEffect(() => {
    if (open) setNote(initialNote);
  }, [open, initialNote]);

  const amount = formatMoney(item.amount);
  const lastStep = !item.totalSteps || item.currentStep === item.totalSteps;
  return (
    <Dialog open={open} onOpenChange={(value) => (pending ? null : onOpenChange(value))}>
      <DialogContent>
        <DialogTitle>
          Approve {amount ? `${amount} ` : ""}
          {item.sourceLabel.toLowerCase()}?
        </DialogTitle>
        <DialogDescription>
          {item.title}
          {item.project ? ` · ${item.project.name}` : ""}.{" "}
          {lastStep
            ? `This is the final approval: the ${item.sourceLabel.toLowerCase()} is approved as soon as you confirm.`
            : `This approves step ${item.currentStep} of ${item.totalSteps}; whoever takes the next step is asked next.`}
        </DialogDescription>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor={`${id}-note`}>Note (optional)</Label>
          <Textarea id={`${id}-note`} rows={3} maxLength={NOTE_LIMIT} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onConfirm(note.trim() || null)} disabled={pending} data-testid="confirm-approve">
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
            Approve {amount ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
