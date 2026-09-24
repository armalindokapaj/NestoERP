"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import {
  Archive,
  CheckCircle2,
  FileSignature,
  PenLine,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Undo2,
  XCircle,
} from "lucide-react";

import { AssignMemberControl } from "@/components/modules/assign-member-control";
import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  assignContractOwnerAction,
  activateContractAction,
  cancelContractAction,
  contractLifecycleAction,
  markSignedAction,
  rejectContractAction,
  returnToDraftAction,
  terminateContractAction,
  type ContractActionResult,
  type ContractLifecycleAction,
} from "@/lib/actions/contracts";
import type { ContractDetailDTO } from "@/lib/modules/contracts/contract.types";

/**
 * Actions on a contract (PRD #18 §108–§135, §359, §362).
 *
 * Three of them are dialogs rather than buttons because each needs something
 * the click cannot supply: a signing date, a termination date and reason, or a
 * rejection note. The rest confirm first where the step is hard to walk back.
 *
 * Only actions the server has already said are available render at all — the
 * capabilities are a UX hint, and the service re-checks every one (PRD #7 §55).
 */
export function ContractActions({ contract }: { contract: ContractDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  const [dialog, setDialog] = React.useState<
    "none" | "signed" | "terminate" | "reject" | "return" | "cancel" | "archive" | "expire"
  >("none");

  const may = contract.capabilities;

  function handle(result: ContractActionResult, success: string) {
    if (result.ok) {
      setDialog("none");
      toast({ title: success, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  }

  function run(action: ContractLifecycleAction, success: string) {
    startTransition(async () => {
      handle(await contractLifecycleAction(contract.id, action), success);
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/contracts/${contract.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canAssignOwner ? (
        <AssignMemberControl
          endpoint="/api/contracts/assignable"
          currentMemberId={contract.owner?.memberId ?? null}
          triggerLabel="Change owner"
          title="Assign this contract"
          description="The owner answers for its obligations and renewal dates."
          onAssign={async (memberId) => {
            const result = await assignContractOwnerAction(contract.id, memberId);
            return { ok: result.ok, message: result.ok ? "Owner changed." : result.error };
          }}
        />
      ) : null}

      {may.canSubmitReview ? (
        <Button size="sm" disabled={pending} onClick={() => run("submit-review", "Contract sent for review.")}>
          <Send aria-hidden="true" />
          Submit for review
        </Button>
      ) : null}

      {may.canReturnToDraft ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("return")}>
          <Undo2 aria-hidden="true" />
          Return to draft
        </Button>
      ) : null}

      {may.canSubmitApproval ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run("submit-approval", "Contract submitted for approval.")}
        >
          <ShieldCheck aria-hidden="true" />
          Submit for approval
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => run("approve", "Contract approved.")}>
          <CheckCircle2 aria-hidden="true" />
          Approve
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          <XCircle aria-hidden="true" />
          Reject
        </Button>
      ) : null}

      {may.canMarkSent ? (
        <Button size="sm" disabled={pending} onClick={() => run("mark-sent", "Contract marked as sent.")}>
          <Send aria-hidden="true" />
          Mark sent
        </Button>
      ) : null}

      {may.canMarkSigned ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("signed")}>
          <FileSignature aria-hidden="true" />
          Mark signed
        </Button>
      ) : null}

      {may.canActivate ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              handle(await activateContractAction(contract.id), "Contract activated.");
            })
          }
        >
          <Play aria-hidden="true" />
          Activate
        </Button>
      ) : null}

      {may.canExpire ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("expire")}>
          Record as expired
        </Button>
      ) : null}

      {may.canTerminate ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("terminate")}>
          <XCircle aria-hidden="true" />
          Terminate
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("archive")}>
          <Archive aria-hidden="true" />
          Archive
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("restore", "Contract restored.")}
        >
          <RotateCcw aria-hidden="true" />
          Restore
        </Button>
      ) : null}

      <MarkSignedDialog
        open={dialog === "signed"}
        onOpenChange={(open) => setDialog(open ? "signed" : "none")}
        contract={contract}
        onDone={(message) => handle({ ok: true }, message)}
        onError={(message) => toast({ title: message, tone: "danger" })}
      />

      <TerminateDialog
        open={dialog === "terminate"}
        onOpenChange={(open) => setDialog(open ? "terminate" : "none")}
        contract={contract}
        onDone={() => handle({ ok: true }, "Contract terminated.")}
        onError={(message) => toast({ title: message, tone: "danger" })}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : "none")}
        title={`Reject ${contract.contractNumber}?`}
        description="The contract returns to review with your reason attached, so whoever drafted it knows what to change."
        placeholder="What needs to change before this can be approved?"
        onReject={async (reason) => {
          const result = await rejectContractAction(contract.id, reason);
          handle(result, "Contract rejected.");
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "return"}
        onOpenChange={(open) => setDialog(open ? "return" : "none")}
        title={`Return ${contract.contractNumber} to draft?`}
        description="The contract goes back to whoever is drafting it. A note is optional but helps."
        label="Note"
        placeholder="What still needs work?"
        confirmLabel="Return to draft"
        pendingLabel="Returning…"
        emptyMessage="Say what needs changing, or leave the note out entirely."
        onReject={async (note) => {
          const result = await returnToDraftAction(contract.id, note);
          handle(result, "Contract returned to draft.");
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : "none")}
        title={`Cancel ${contract.contractNumber}?`}
        description="The contract stops before signature. Its history is kept."
        label="Reason"
        placeholder="Why is this contract not going ahead?"
        confirmLabel="Cancel contract"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it was cancelled, so the record explains itself."
        onReject={async (note) => {
          const result = await cancelContractAction(contract.id, note);
          handle(result, "Contract cancelled.");
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "expire"}
        onOpenChange={(open) => setDialog(open ? "expire" : "none")}
        title="Record this contract as expired?"
        description="Reporting has treated it as expired since the day it ended. This makes the stored status agree."
        confirmLabel="Record as expired"
        destructive={false}
        pending={pending}
        onConfirm={() => run("expire", "Contract recorded as expired.")}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : "none")}
        title="Archive this contract?"
        description="It leaves the working lists. Documents, obligations and amendments are all kept, and restoring it returns the status it holds now."
        confirmLabel="Archive contract"
        destructive={false}
        pending={pending}
        onConfirm={() => run("archive", "Contract archived.")}
      />
    </>
  );
}

/**
 * Signing needs a date, and asks once about the missing file (PRD #18 §118, §119).
 *
 * The server refuses the first attempt when nothing is attached and says so;
 * the dialog then offers to record it anyway. Somebody holding a scanned
 * signature page they cannot upload yet still has a signed contract.
 */
function MarkSignedDialog({
  open,
  onOpenChange,
  contract,
  onDone,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: ContractDetailDTO;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [signedDate, setSignedDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [missingDocument, setMissingDocument] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) setMissingDocument(false);
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await markSignedAction(contract.id, {
        signedDate,
        acknowledgeMissingDocument: missingDocument,
      });

      if (result.ok) {
        onOpenChange(false);
        onDone("Contract recorded as signed.");
        return;
      }

      if (result.code === "SIGNED_DOCUMENT_MISSING") {
        setMissingDocument(true);
        return;
      }

      onError(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Record {contract.contractNumber} as signed</DialogTitle>
        <DialogDescription>
          The date the last party signed. It may be after the effective date.
        </DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="signedDate">Signed date</Label>
            <Input
              id="signedDate"
              type="date"
              value={signedDate}
              onChange={(event) => setSignedDate(event.target.value)}
              required
            />
          </div>

          {missingDocument ? (
            <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-table text-warning-strong">
              No signed contract document is attached. Continue to record the signature anyway — you
              can add the executed copy later.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : missingDocument ? "Record anyway" : "Record as signed"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Termination states what it does before it does it (PRD #18 §362).
 *
 * The contract, the consequence, the date and the reason — all four visible in
 * the dialog, because ending an agreement early is not an action anybody should
 * take from muscle memory.
 */
function TerminateDialog({
  open,
  onOpenChange,
  contract,
  onDone,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: ContractDetailDTO;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [terminationDate, setTerminationDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 2) {
      setError("Say why the agreement was ended. It becomes part of the record.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await terminateContractAction(contract.id, {
        terminationDate,
        terminationReason: reason.trim(),
      });

      if (result.ok) {
        onOpenChange(false);
        onDone();
      } else {
        onError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Terminate {contract.contractNumber}?</DialogTitle>
        <DialogDescription>
          {contract.title} ends on the date below. Its documents, obligations and amendments are all
          kept; open obligations stay open until somebody closes them.
        </DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="terminationDate">Termination date</Label>
            <Input
              id="terminationDate"
              type="date"
              value={terminationDate}
              onChange={(event) => setTerminationDate(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="terminationReason">Reason</Label>
            <Textarea
              id="terminationReason"
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Which clause was relied on, and why."
            />
            {error ? <p className="text-meta text-danger-strong">{error}</p> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Keep the contract
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Terminating…" : "Terminate contract"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
