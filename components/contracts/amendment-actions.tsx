"use client";

import * as React from "react";
import { localToday } from "@/components/finance/local-date";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { CheckCircle2, FileSignature, PenLine, Play, Send, XCircle } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DialogEditor, useOpenedWith } from "@/components/sales/unit-sales/unit-sales-dialogs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import {
  amendmentLifecycleAction,
  markAmendmentSignedAction,
  rejectAmendmentAction,
  type AmendmentLifecycleAction,
  type ContractActionResult,
} from "@/lib/actions/contracts";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { ContractAmendmentDTO } from "@/lib/modules/contracts/contract.types";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";

/**
 * Actions on an amendment (PRD #18 §170–§180).
 *
 * Activation is behind a confirmation because it is the moment the contract's
 * value and expiry actually change. It is applied once: a second attempt is
 * refused rather than reapplied (PRD #18 §511).
 */
export function AmendmentActions({
  contractId,
  amendment,
  cycle,
}: {
  contractId: string;
  amendment: ContractAmendmentDTO;
  /** The approval cycle on screen; approve and reject name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<
    "none" | "signed" | "reject" | "cancel" | "activate" | "archive"
  >("none");

  const may = amendment.capabilities;

  function handle(result: ContractActionResult, success: string) {
    if (result.ok) {
      setDialog("none");
      toast({ title: success, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  }

  function run(action: AmendmentLifecycleAction, success: string) {
    startTransition(async () => {
      handle(await amendmentLifecycleAction(contractId, amendment.id, action, undefined, cycle), success);
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/contracts/${contractId}/amendments/${amendment.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" disabled={pending} onClick={() => run("submit", "Amendment submitted for approval.")}>
          <Send aria-hidden="true" />
          Submit for approval
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => run("approve", "Amendment approved.")}>
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
        <Button size="sm" disabled={pending} onClick={() => run("mark-sent", "Amendment marked as sent.")}>
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
        <Button size="sm" disabled={pending} onClick={() => setDialog("activate")}>
          <Play aria-hidden="true" />
          Activate
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("archive")}>
          Archive
        </Button>
      ) : null}

      <SignedDialog
        open={dialog === "signed"}
        onOpenChange={(open) => setDialog(open ? "signed" : "none")}
        contractId={contractId}
        amendment={amendment}
        onDone={() => handle({ ok: true }, "Amendment recorded as signed.")}
        onError={(message) => toast({ title: message, tone: "danger" })}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : "none")}
        title={`Reject ${amendment.amendmentNumber}?`}
        description="The amendment goes back to its author with your reason attached."
        onReject={async (reason) => {
          const result = await rejectAmendmentAction(contractId, amendment.id, reason, cycle);
          handle(result, "Amendment rejected.");
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : "none")}
        title={`Cancel ${amendment.amendmentNumber}?`}
        description="The amendment stops before it is executed. The contract is unchanged."
        label="Reason"
        placeholder="Why is this amendment not going ahead?"
        confirmLabel="Cancel amendment"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it was cancelled, so the record explains itself."
        onReject={async (note) => {
          const result = await amendmentLifecycleAction(contractId, amendment.id, "cancel", note);
          handle(result, "Amendment cancelled.");
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "activate"}
        onOpenChange={(open) => setDialog(open ? "activate" : "none")}
        title={`Apply ${amendment.amendmentNumber} to the contract?`}
        description="The new value and expiry date are written onto the contract now. What it held before is kept on the amendment, and this can only happen once."
        confirmLabel="Activate amendment"
        destructive={false}
        pending={pending}
        onConfirm={() => run("activate", "Amendment applied to the contract.")}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : "none")}
        title="Archive this amendment?"
        description="It leaves the amendment list. Only a draft, rejected or cancelled amendment can be archived — an executed one stays visible."
        confirmLabel="Archive amendment"
        destructive={false}
        pending={pending}
        onConfirm={() => run("archive", "Amendment archived.")}
      />
    </>
  );
}

function SignedDialog({
  open,
  onOpenChange,
  contractId,
  amendment,
  onDone,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  amendment: ContractAmendmentDTO;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [signedDate, setSignedDate] = React.useState(() => localToday());
  const [unresolved, setUnresolved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  // Recording the signature is the only way forward: leaving offers Stay or Discard (AUD-03 §4).
  const changed = useOpenedWith(open, signedDate);

  React.useEffect(() => {
    if (!open) {
      // Reset only once the dialog has closed through its guard.
      setSignedDate(localToday());
      setUnresolved(false);
    }
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setUnresolved(false);
      let result: Awaited<ReturnType<typeof markAmendmentSignedAction>>;
      try {
        result = await markAmendmentSignedAction(contractId, amendment.id, signedDate);
      } catch {
        // The request may have gone through (AUD-03 §6).
        setUnresolved(true);
        onError(OUTCOME_COPY.unknown);
        return;
      }
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
        <DialogEditor label={`Signature of ${amendment.amendmentNumber}`} module="contracts" dirty={changed} saving={pending} unresolved={unresolved} workflow="Record as signed" />
        <DialogTitle>Record {amendment.amendmentNumber} as signed</DialogTitle>
        <DialogDescription>
          Signing does not change the contract. Activating the amendment does.
        </DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="amendment-signed">Signed date</Label>
            <Input
              id="amendment-signed"
              type="date"
              value={signedDate}
              onChange={(event) => setSignedDate(event.target.value)}
              required
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record as signed"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
