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

import { useFinanceTranslations } from "@/components/finance/finance-text";
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
import type { Translate } from "@/lib/i18n/translator";
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
  const t = useFinanceTranslations();
  const kindLabel = t(`kindSubject.${kind}`);
  const kindLower = t(`kindLower.${kind}`);
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
            {t("actions.edit")}
          </Link>
        </Button>
      ) : null}

      {capabilities.canSubmit ? (
        <Button size="sm" onClick={() => run("submit", t("actions.submitted"))} disabled={busy} aria-busy={running === "submit" || undefined}>
          <Send aria-hidden="true" />
          {buttonText("submit", t("actions.submit"), t("actions.submitting"))}
        </Button>
      ) : null}

      {capabilities.canApprove ? (
        <Button size="sm" onClick={() => run("approve", t("actions.approved", { kind: kindLabel }))} disabled={busy} aria-busy={running === "approve" || undefined}>
          <ThumbsUp aria-hidden="true" />
          {buttonText("approve", t("actions.approve"), t("actions.approving"))}
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
          {t("actions.reject")}
        </Button>
      ) : null}

      {capabilities.canMarkSent ? (
        <Button size="sm" onClick={() => run("mark-sent", t("actions.markedSent"))} disabled={busy} aria-busy={running === "mark-sent" || undefined}>
          <SendHorizontal aria-hidden="true" />
          {buttonText("mark-sent", t("actions.markSent"), t("actions.markingSent"))}
        </Button>
      ) : null}

      {capabilities.canRestore ? (
        <Button size="sm" onClick={() => run("restore", t("actions.restored", { kind: kindLabel }))} disabled={busy} aria-busy={running === "restore" || undefined}>
          <ArchiveRestore aria-hidden="true" />
          {buttonText("restore", t("actions.restore"), t("actions.restoring"))}
        </Button>
      ) : null}

      {capabilities.canRevise ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`${editHref.replace(/\/edit$/, "")}/revise`}>
            <CheckCheck aria-hidden="true" />
            {t("actions.createRevision")}
          </Link>
        </Button>
      ) : null}

      {capabilities.canClose || capabilities.canCancel || capabilities.canArchive ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("actions.moreFor", { label })}>
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
                {t("actions.closeCommitment")}
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
                {t("actions.cancelKind", { kind: kindLower })}
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
                {t("actions.archiveKind", { kind: kindLower })}
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
        title={confirmTitle(t, confirming, label)}
        description={confirmBody(t, confirming, kind)}
        confirmLabel={
          confirming === "close" ? t("actions.close") : confirming === "cancel" ? t("actions.cancelIt") : t("actions.archive")
        }
        pending={busy}
        onConfirm={() => {
          if (confirming === "close") run("close", t("actions.commitmentClosed"));
          else if (confirming === "cancel") run("cancel", t("actions.cancelled", { kind: kindLabel }));
          else if (confirming === "archive") run("archive", t("actions.archived", { kind: kindLabel }));
        }}
      />

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t("actions.rejectTitle", { label })}
        description={t("reject.description")}
        label={t("reject.label")}
        placeholder={t("reject.placeholder")}
        confirmLabel={t("reject.confirm")}
        pendingLabel={t("reject.pending")}
        emptyMessage={t("reject.empty")}
        onReject={async (reason) => {
          const result = await reject(reason);
          if (result.ok) {
            toast({ title: t("actions.rejected", { kind: kindLabel }) });
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

function confirmTitle(
  t: Translate<"finance">,
  action: "cancel" | "archive" | "close" | null,
  label: string,
): string {
  if (action === "close") return t("actions.closeTitle", { label });
  if (action === "cancel") return t("actions.cancelTitle", { label });
  return t("actions.archiveTitle", { label });
}

function confirmBody(
  t: Translate<"finance">,
  action: "cancel" | "archive" | "close" | null,
  kind: FinanceRecordKind,
): string {
  if (action === "close") return t("actions.closeBody");
  if (action === "cancel") return kind === "invoice" ? t("actions.cancelInvoiceBody") : t("actions.cancelBody");
  return t("actions.archiveBody");
}
