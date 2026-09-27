"use client";

import * as React from "react";
import { localToday } from "@/components/finance/local-date";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
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
import { DialogEditor, useOpenedWith } from "@/components/sales/unit-sales/unit-sales-dialogs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { ContractDetailDTO } from "@/lib/modules/contracts/contract.types";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { useContractsTranslations } from "./contracts-text";

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
export function ContractActions({
  contract,
  cycle,
}: {
  contract: ContractDetailDTO;
  /** The approval cycle on screen; approve and reject name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const t = useContractsTranslations();
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
      handle(await contractLifecycleAction(contract.id, action, undefined, cycle), success);
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/contracts/${contract.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canAssignOwner ? (
        <AssignMemberControl
          endpoint="/api/contracts/assignable"
          currentMemberId={contract.owner?.memberId ?? null}
          triggerLabel={t("actions.changeOwner")}
          title={t("actions.assignTitle")}
          description={t("actions.assignDescription")}
          onAssign={async (memberId) => {
            const result = await assignContractOwnerAction(contract.id, memberId);
            return { ok: result.ok, message: result.ok ? t("actions.ownerChanged") : result.error };
          }}
        />
      ) : null}

      {may.canSubmitReview ? (
        <Button size="sm" disabled={pending} onClick={() => run("submit-review", t("actions.sentForReview"))}>
          <Send aria-hidden="true" />
          {t("actions.submitReview")}
        </Button>
      ) : null}

      {may.canReturnToDraft ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("return")}>
          <Undo2 aria-hidden="true" />
          {t("common.returnToDraft")}
        </Button>
      ) : null}

      {may.canSubmitApproval ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run("submit-approval", t("actions.submittedForApproval"))}
        >
          <ShieldCheck aria-hidden="true" />
          {t("common.submitForApproval")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => run("approve", t("actions.approved"))}>
          <CheckCircle2 aria-hidden="true" />
          {t("common.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          <XCircle aria-hidden="true" />
          {t("common.reject")}
        </Button>
      ) : null}

      {may.canMarkSent ? (
        <Button size="sm" disabled={pending} onClick={() => run("mark-sent", t("actions.markedSent"))}>
          <Send aria-hidden="true" />
          {t("common.markSent")}
        </Button>
      ) : null}

      {may.canMarkSigned ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("signed")}>
          <FileSignature aria-hidden="true" />
          {t("common.markSigned")}
        </Button>
      ) : null}

      {may.canActivate ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              handle(await activateContractAction(contract.id), t("actions.activated"));
            })
          }
        >
          <Play aria-hidden="true" />
          {t("common.activate")}
        </Button>
      ) : null}

      {may.canExpire ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("expire")}>
          {t("actions.recordExpired")}
        </Button>
      ) : null}

      {may.canTerminate ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("terminate")}>
          <XCircle aria-hidden="true" />
          {t("actions.terminate")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          {t("common.cancel")}
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("archive")}>
          <Archive aria-hidden="true" />
          {t("common.archive")}
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("restore", t("actions.restored"))}
        >
          <RotateCcw aria-hidden="true" />
          {t("actions.restore")}
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
        onDone={() => handle({ ok: true }, t("actions.terminated"))}
        onError={(message) => toast({ title: message, tone: "danger" })}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : "none")}
        title={t("common.rejectNumber", { number: contract.contractNumber })}
        description={t("actions.rejectDescription")}
        placeholder={t("actions.rejectPlaceholder")}
        onReject={async (reason) => {
          const result = await rejectContractAction(contract.id, reason, cycle);
          handle(result, t("actions.rejected"));
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "return"}
        onOpenChange={(open) => setDialog(open ? "return" : "none")}
        title={t("actions.returnTitle", { number: contract.contractNumber })}
        description={t("actions.returnDescription")}
        label={t("common.note")}
        placeholder={t("actions.returnPlaceholder")}
        confirmLabel={t("common.returnToDraft")}
        pendingLabel={t("actions.returning")}
        emptyMessage={t("actions.returnEmpty")}
        onReject={async (note) => {
          const result = await returnToDraftAction(contract.id, note);
          handle(result, t("actions.returned"));
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : "none")}
        title={t("common.cancelNumber", { number: contract.contractNumber })}
        description={t("actions.cancelDescription")}
        label={t("common.reason")}
        placeholder={t("actions.cancelPlaceholder")}
        confirmLabel={t("actions.cancelContract")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("common.sayWhyCancelled")}
        onReject={async (note) => {
          const result = await cancelContractAction(contract.id, note);
          handle(result, t("actions.cancelled"));
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "expire"}
        onOpenChange={(open) => setDialog(open ? "expire" : "none")}
        title={t("actions.expireTitle")}
        description={t("actions.expireDescription")}
        confirmLabel={t("actions.recordExpired")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("expire", t("actions.expired"))}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : "none")}
        title={t("actions.archiveTitle")}
        description={t("actions.archiveDescription")}
        confirmLabel={t("actions.archiveContract")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("archive", t("actions.archived"))}
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
  const t = useContractsTranslations();
  const [signedDate, setSignedDate] = React.useState(() => localToday());
  const [missingDocument, setMissingDocument] = React.useState(false);
  const [unresolved, setUnresolved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  // A changed date is unsaved input; recording the signature is the only way
  // forward, so leaving offers Stay or Discard (AUD-03 §3, §4).
  const changed = useOpenedWith(open, signedDate);

  React.useEffect(() => {
    if (!open) {
      // Reset only once the dialog has closed through its guard.
      setMissingDocument(false);
      setSignedDate(localToday());
      setUnresolved(false);
    }
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setUnresolved(false);
      let result: ContractActionResult;
      try {
        result = await markSignedAction(contract.id, {
          signedDate,
          acknowledgeMissingDocument: missingDocument,
        });
      } catch {
        // The request may have gone through (AUD-03 §6).
        setUnresolved(true);
        onError(OUTCOME_COPY.unknown);
        return;
      }

      if (result.ok) {
        onOpenChange(false);
        onDone(t("actions.signed"));
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
        <DialogEditor label={t("common.signatureOf", { number: contract.contractNumber })} module="contracts" dirty={changed} saving={pending} unresolved={unresolved} workflow={t("common.recordAsSigned")} />
        <DialogTitle>{t("common.recordNumberAsSigned", { number: contract.contractNumber })}</DialogTitle>
        <DialogDescription>{t("actions.signedDescription")}</DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="signedDate">{t("common.signedDate")}</Label>
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
              {t("actions.missingDocument")}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : missingDocument ? t("actions.recordAnyway") : t("common.recordAsSigned")}
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
  const t = useContractsTranslations();
  const [terminationDate, setTerminationDate] = React.useState(() =>
    localToday(),
  );
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [unresolved, setUnresolved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  // Terminating is the only way forward: leaving offers Stay or Discard (AUD-03 §4).
  const changed = useOpenedWith(open, [terminationDate, reason]);

  React.useEffect(() => {
    if (!open) {
      // Reset only once the dialog has closed through its guard.
      setReason("");
      setTerminationDate(localToday());
      setError(null);
      setUnresolved(false);
    }
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 2) {
      setError(t("actions.terminationRequired"));
      return;
    }

    setError(null);
    startTransition(async () => {
      setUnresolved(false);
      let result: ContractActionResult;
      try {
        result = await terminateContractAction(contract.id, {
          terminationDate,
          terminationReason: reason.trim(),
        });
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
        <DialogEditor label={t("actions.terminationOf", { number: contract.contractNumber })} module="contracts" dirty={changed} saving={pending} unresolved={unresolved} workflow={t("actions.terminate")} />
        <DialogTitle>{t("actions.terminateTitle", { number: contract.contractNumber })}</DialogTitle>
        <DialogDescription>{t("actions.terminateDescription", { title: contract.title })}</DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="terminationDate">{t("actions.terminationDate")}</Label>
            <Input
              id="terminationDate"
              type="date"
              value={terminationDate}
              onChange={(event) => setTerminationDate(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="terminationReason">{t("common.reason")}</Label>
            <Textarea
              id="terminationReason"
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("actions.terminationPlaceholder")}
            />
            {error ? <p className="text-meta text-danger-strong">{error}</p> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                {t("actions.keep")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? t("actions.terminating") : t("actions.terminateContract")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
