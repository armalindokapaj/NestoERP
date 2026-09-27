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
import { useContractsTranslations } from "./contracts-text";

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
  const t = useContractsTranslations();
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
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" disabled={pending} onClick={() => run("submit", t("amendmentActions.submitted"))}>
          <Send aria-hidden="true" />
          {t("common.submitForApproval")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => run("approve", t("amendmentActions.approved"))}>
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
        <Button size="sm" disabled={pending} onClick={() => run("mark-sent", t("amendmentActions.markedSent"))}>
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
        <Button size="sm" disabled={pending} onClick={() => setDialog("activate")}>
          <Play aria-hidden="true" />
          {t("common.activate")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          {t("common.cancel")}
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("archive")}>
          {t("common.archive")}
        </Button>
      ) : null}

      <SignedDialog
        open={dialog === "signed"}
        onOpenChange={(open) => setDialog(open ? "signed" : "none")}
        contractId={contractId}
        amendment={amendment}
        onDone={() => handle({ ok: true }, t("amendmentActions.signed"))}
        onError={(message) => toast({ title: message, tone: "danger" })}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : "none")}
        title={t("common.rejectNumber", { number: amendment.amendmentNumber })}
        description={t("amendmentActions.rejectDescription")}
        onReject={async (reason) => {
          const result = await rejectAmendmentAction(contractId, amendment.id, reason, cycle);
          handle(result, t("amendmentActions.rejected"));
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : "none")}
        title={t("common.cancelNumber", { number: amendment.amendmentNumber })}
        description={t("amendmentActions.cancelDescription")}
        label={t("common.reason")}
        placeholder={t("amendmentActions.cancelPlaceholder")}
        confirmLabel={t("amendmentActions.cancelAmendment")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("common.sayWhyCancelled")}
        onReject={async (note) => {
          const result = await amendmentLifecycleAction(contractId, amendment.id, "cancel", note);
          handle(result, t("amendmentActions.cancelled"));
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "activate"}
        onOpenChange={(open) => setDialog(open ? "activate" : "none")}
        title={t("amendmentActions.activateTitle", { number: amendment.amendmentNumber })}
        description={t("amendmentActions.activateDescription")}
        confirmLabel={t("amendmentActions.activateAmendment")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("activate", t("amendmentActions.activated"))}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : "none")}
        title={t("amendmentActions.archiveTitle")}
        description={t("amendmentActions.archiveDescription")}
        confirmLabel={t("amendmentActions.archiveAmendment")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("archive", t("amendmentActions.archived"))}
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
  const t = useContractsTranslations();
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
        <DialogEditor label={t("common.signatureOf", { number: amendment.amendmentNumber })} module="contracts" dirty={changed} saving={pending} unresolved={unresolved} workflow={t("common.recordAsSigned")} />
        <DialogTitle>{t("common.recordNumberAsSigned", { number: amendment.amendmentNumber })}</DialogTitle>
        <DialogDescription>{t("amendmentActions.signedDescription")}</DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="amendment-signed">{t("common.signedDate")}</Label>
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
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.recordAsSigned")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
