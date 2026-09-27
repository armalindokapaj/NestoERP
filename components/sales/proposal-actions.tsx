"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import {
  Archive,
  Ban,
  PenLine,
  RotateCcw,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  proposalLifecycleAction,
  rejectProposalAction,
  type ProposalLifecycleAction,
} from "@/lib/actions/sales";
import { useSalesServerText, useSalesTranslations } from "@/components/sales/sales-text";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { ProposalDetailDTO } from "@/lib/modules/sales/sales.types";

/**
 * Actions on a proposal (PRD #17 §116–§125, §294).
 *
 * Capabilities are hints: the server re-checks every one, including the rule
 * that the person who submitted a price cannot approve it — which is why an
 * approver never sees Approve on their own proposal (PRD #17 §20).
 */
export function ProposalActions({
  proposal,
  cycle,
}: {
  proposal: ProposalDetailDTO;
  /** The approval cycle on screen; approve and reject name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const t = useSalesTranslations();
  const serverText = useSalesServerText();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [rejecting, setRejecting] = React.useState(false);
  const [confirming, setConfirming] = React.useState<null | {
    action: ProposalLifecycleAction;
    title: string;
    description: string;
    confirmLabel: string;
    success: string;
  }>(null);

  const may = proposal.capabilities;

  function run(action: ProposalLifecycleAction, success: string) {
    startTransition(async () => {
      const result = await proposalLifecycleAction(proposal.id, action, undefined, cycle);
      setConfirming(null);
      if (result.ok) {
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/sales/proposals/${proposal.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" onClick={() => run("submit", t("proposalActions.submitted"))} disabled={pending}>
          <Send aria-hidden="true" />
          {pending ? t("common.working") : t("proposalActions.submit")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" onClick={() => run("approve", t("proposalActions.approved"))} disabled={pending}>
          <ThumbsUp aria-hidden="true" />
          {pending ? t("common.working") : t("proposalActions.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" onClick={() => setRejecting(true)} disabled={pending}>
          <ThumbsDown aria-hidden="true" />
          {t("proposalActions.reject")}
        </Button>
      ) : null}

      {may.canMarkSent ? (
        <Button size="sm" onClick={() => run("mark-sent", t("proposalActions.markedSent"))} disabled={pending}>
          <Send aria-hidden="true" />
          {t("proposalActions.markSent")}
        </Button>
      ) : null}

      {may.canAccept ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            setConfirming({
              action: "accept",
              title: t("proposalActions.acceptTitle"),
              description: t("proposalActions.acceptDescription"),
              confirmLabel: t("proposalActions.acceptConfirm"),
              success: t("proposalActions.accepted"),
            })
          }
        >
          <ThumbsUp aria-hidden="true" />
          {t("proposalActions.acceptedButton")}
        </Button>
      ) : null}

      {may.canDecline ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            setConfirming({
              action: "decline",
              title: t("proposalActions.declineTitle"),
              description: t("proposalActions.declineDescription"),
              confirmLabel: t("proposalActions.declineConfirm"),
              success: t("proposalActions.declined"),
            })
          }
        >
          <ThumbsDown aria-hidden="true" />
          {t("proposalActions.declinedButton")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            setConfirming({
              action: "cancel",
              title: t("proposalActions.cancelTitle"),
              description: t("proposalActions.cancelDescription"),
              confirmLabel: t("proposalActions.cancelConfirm"),
              success: t("proposalActions.cancelled"),
            })
          }
        >
          <Ban aria-hidden="true" />
          {t("common.cancel")}
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            setConfirming({
              action: "archive",
              title: t("proposalActions.archiveTitle"),
              description: t("proposalActions.archiveDescription"),
              confirmLabel: t("proposalActions.archiveConfirm"),
              success: t("proposalActions.archived"),
            })
          }
        >
          <Archive aria-hidden="true" />
          {t("common.archive")}
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("restore", t("proposalActions.restored"))}
          disabled={pending}
        >
          <RotateCcw aria-hidden="true" />
          {t("common.restore")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming?.title ?? ""}
        description={confirming?.description ?? ""}
        confirmLabel={confirming?.confirmLabel ?? t("proposalActions.confirm")}
        destructive={confirming?.action === "cancel"}
        pending={pending}
        onConfirm={() => {
          if (confirming) run(confirming.action, confirming.success);
        }}
      />

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t("proposalActions.rejectTitle")}
        description={t("proposalActions.rejectDescription")}
        placeholder={t("proposalActions.rejectPlaceholder")}
        onReject={async (reason) => {
          const result = await rejectProposalAction(proposal.id, reason, cycle);
          if (result.ok) {
            toast({ title: t("proposalActions.rejected") });
            setRejecting(false);
            router.refresh();
          } else {
            toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
          }
          return result.ok;
        }}
      />
    </>
  );
}
