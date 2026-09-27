"use client";

import * as React from "react";
import { Check, CornerUpLeft, Loader2, MessageSquarePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { ApprovalDecision, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import { cn } from "@/lib/utils/cn";
import { useApprovalDraft, useForgetApprovalDrafts } from "./approval-drafts";
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
  failure = null,
  onDecide,
  className,
}: {
  item: UnifiedApprovalItem;
  pending: ApprovalDecision | null;
  /** The last decision's refusal, shown inside an open dialog too (AUD-10 §4, MW-12). */
  failure?: DecisionFailure | null;
  onDecide: (decision: ApprovalDecision, note: string | null) => Promise<boolean>;
  className?: string;
}) {
  // Held by the Center, not here: a rotation that moves the review between the
  // side panel and the sheet keeps the note and an open reason (AUD-04 MW-16).
  // The bar is keyed by the approval, so another approval starts clean.
  const [dialog, setDialog] = useApprovalDraft<ApprovalDecision | null>(`${item.id}:dialog`, null);
  const [note, setNote] = useApprovalDraft(`${item.id}:note`, "");
  const [noteOpen, setNoteOpen] = useApprovalDraft(`${item.id}:noteOpen`, false);
  const forget = useForgetApprovalDrafts();
  const busy = pending !== null;
  const any = item.canApprove || item.canReject || item.canReturn;
  const noun = item.sourceLabel.toLowerCase();

  /** A dialog that closes takes its input with it: opened again, it starts empty. */
  function closeDialog() {
    forget(`${item.id}:reason:REJECT`, `${item.id}:reason:RETURN`, `${item.id}:strongNote`);
    setDialog(null);
  }

  // A note typed with an approval is unsaved work whose only way forward is
  // deciding: a workflow step the prompt never takes (AUD-03 §3).
  const editor = useUnsavedEditor({ module: "approvals", saveKind: "none", workflow: "Approve", label: "Your approval note" });
  const { setDirty, setSaving } = editor;
  React.useEffect(() => setDirty(item.canApprove && note !== ""), [item.canApprove, note, setDirty]);
  React.useEffect(() => setSaving(pending === "APPROVE" && dialog === null), [pending, dialog, setSaving]);

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
      setDirty(false);
      setNote("");
      setNoteOpen(false);
    }
  }

  const approveLabel = item.totalSteps && item.currentStep && item.currentStep < item.totalSteps ? `Approve step ${item.currentStep}` : "Approve";

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
      {/*
        One row from 640px. On a phone Approve takes the full width on its own
        row and Return / Reject share the next, so no button is ever pushed off
        the screen at 320px; Add note stays available above them (AUD-04 §6,
        MW-12). Every button is present at every width — only the flow changes.
      */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        {item.canApprove && !noteOpen ? (
          <Button type="button" variant="ghost" size="sm" className="order-first basis-full justify-start sm:order-none sm:mr-auto sm:basis-auto" onClick={() => setNoteOpen(true)} disabled={busy}>
            <MessageSquarePlus aria-hidden="true" />
            Add note
          </Button>
        ) : (
          <span className="hidden sm:mr-auto sm:block" />
        )}
        {item.canReturn ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="min-w-0 flex-1 sm:flex-none"
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
            className="min-w-0 flex-1 text-danger-strong hover:text-danger-strong sm:flex-none"
            disabled={busy}
            onClick={() => setDialog("REJECT")}
            aria-label={`Reject this ${noun}`}
          >
            {pending === "REJECT" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <X aria-hidden="true" />}
            Reject
          </Button>
        ) : null}
        {item.canApprove ? (
          <Button
            type="button"
            size="lg"
            className="order-first min-w-0 basis-full sm:order-none sm:min-w-32 sm:basis-auto"
            disabled={busy}
            onClick={() => void approve()}
            aria-label={`Approve this ${noun}`}
            data-testid="decision-approve"
          >
            {pending === "APPROVE" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
            {approveLabel}
          </Button>
        ) : null}
      </div>

      <ReasonDialog
        open={dialog === "REJECT" || dialog === "RETURN"}
        decision={dialog === "RETURN" ? "RETURN" : "REJECT"}
        item={item}
        pending={pending}
        failure={failure}
        onOpenChange={(open) => (open ? null : closeDialog())}
        onSubmit={async (reason) => {
          const ok = await onDecide(dialog === "RETURN" ? "RETURN" : "REJECT", reason);
          if (ok) closeDialog();
          return ok;
        }}
      />
      <StrongApproveDialog
        open={dialog === "APPROVE"}
        item={item}
        pending={pending === "APPROVE"}
        failure={failure}
        initialNote={note}
        onOpenChange={(open) => (open ? null : closeDialog())}
        onConfirm={async (confirmedNote) => {
          const ok = await onDecide("APPROVE", confirmedNote);
          if (ok) {
            setDirty(false);
            closeDialog();
            setNote("");
            setNoteOpen(false);
          }
          return ok;
        }}
      />
    </div>
  );
}

export type DecisionFailure = { message: string; stale: boolean };

/** A refusal from the server, inside the dialog that asked for it (AUD-10 §4). */
function DialogFailure({ failure }: { failure: DecisionFailure }) {
  return (
    <p role="alert" className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-table text-fg" data-testid="decision-dialog-failure">
      {failure.message}
      {failure.stale ? " Nothing was decided. Cancel, then reload the approval to see where it stands now." : null}
    </p>
  );
}

type ReasonDialogProps = {
  open: boolean;
  decision: "REJECT" | "RETURN";
  item: UnifiedApprovalItem;
  pending: ApprovalDecision | null;
  failure: DecisionFailure | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<boolean>;
};

function ReasonDialog(props: ReasonDialogProps) {
  const { open, decision, item, pending, onOpenChange } = props;
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
        {/* Inside the dialog, so the reason belongs to its guarded close (AUD-03 §5). Opened afresh it starts empty; a rotation keeps it (AUD-04 MW-16). */}
        <ReasonForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({ decision, item, pending, failure, onSubmit }: ReasonDialogProps) {
  const [reason, setReason] = useApprovalDraft(`${item.id}:reason:${decision}`, "");
  const [error, setError] = React.useState<string | null>(null);
  // A refusal belongs here once this dialog has sent something (AUD-10 §4).
  const [sent, setSent] = React.useState(false);
  const id = React.useId();
  const reject = decision === "REJECT";
  const busy = pending !== null;

  // Rejecting and returning are workflow steps: the prompt never takes them (AUD-03 §3).
  const editor = useUnsavedEditor({ module: "approvals", saveKind: "none", workflow: reject ? "Reject" : "Return", label: reject ? "Reason for rejecting" : "What needs to change" });
  const { setDirty, setSaving } = editor;
  React.useEffect(() => setDirty(reason !== ""), [reason, setDirty]);
  React.useEffect(() => setSaving(busy), [busy, setSaving]);

  return (
    <form
      className="mt-4 space-y-1.5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!reason.trim()) {
          setError(reject ? "Give a reason for rejecting it." : "Say what needs to change.");
          return;
        }
        setSent(true);
        if (await onSubmit(reason.trim())) setDirty(false);
      }}
    >
      <Label htmlFor={`${id}-reason`}>{reject ? "Reason for rejecting" : "What needs to change"}</Label>
      <Textarea
        id={`${id}-reason`}
        rows={4}
        autoFocus
        maxLength={NOTE_LIMIT}
        value={reason}
        readOnly={busy}
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
      {sent && failure && !busy ? <DialogFailure failure={failure} /> : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant={reject ? "danger" : "primary"} disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {reject ? "Reject" : "Return for revision"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type StrongApproveProps = {
  open: boolean;
  item: UnifiedApprovalItem;
  pending: boolean;
  failure: DecisionFailure | null;
  initialNote: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string | null) => Promise<boolean>;
};

function StrongApproveDialog(props: StrongApproveProps) {
  const { open, item, pending, onOpenChange } = props;
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
        {/* Inside the dialog, so the note belongs to its guarded close (AUD-03 §5). Opened afresh from the bar's note; a rotation keeps it (AUD-04 MW-16). */}
        <StrongApproveForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function StrongApproveForm({ item, pending, failure, initialNote, onConfirm }: StrongApproveProps) {
  const [note, setNote] = useApprovalDraft(`${item.id}:strongNote`, initialNote);
  const [sent, setSent] = React.useState(false);
  const id = React.useId();
  const amount = formatMoney(item.amount);

  // Approving is a workflow step: the prompt never approves (AUD-03 §3). The
  // note carried over from the bar is still the bar's; what changed here counts.
  const editor = useUnsavedEditor({ module: "approvals", saveKind: "none", workflow: "Approve", label: "Your approval note" });
  const { setDirty, setSaving } = editor;
  React.useEffect(() => setDirty(note !== initialNote), [note, initialNote, setDirty]);
  React.useEffect(() => setSaving(pending), [pending, setSaving]);

  return (
    <>
      <div className="mt-4 space-y-1.5">
        <Label htmlFor={`${id}-note`}>Note (optional)</Label>
        <Textarea id={`${id}-note`} rows={3} maxLength={NOTE_LIMIT} value={note} readOnly={pending} onChange={(event) => setNote(event.target.value)} />
      </div>
      {sent && failure && !pending ? <DialogFailure failure={failure} /> : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="button"
          onClick={async () => {
            setSent(true);
            if (await onConfirm(note.trim() || null)) setDirty(false);
          }}
          disabled={pending}
          data-testid="confirm-approve"
        >
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
          Approve {amount ?? ""}
        </Button>
      </DialogFooter>
    </>
  );
}
