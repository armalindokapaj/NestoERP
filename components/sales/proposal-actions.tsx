"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import type { ProposalDetailDTO } from "@/lib/modules/sales/sales.types";

/**
 * Actions on a proposal (PRD #17 §116–§125, §294).
 *
 * Capabilities are hints: the server re-checks every one, including the rule
 * that the person who submitted a price cannot approve it — which is why an
 * approver never sees Approve on their own proposal (PRD #17 §20).
 */
export function ProposalActions({ proposal }: { proposal: ProposalDetailDTO }) {
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
      const result = await proposalLifecycleAction(proposal.id, action);
      setConfirming(null);
      if (result.ok) {
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/sales/proposals/${proposal.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" onClick={() => run("submit", "Proposal submitted.")} disabled={pending}>
          <Send aria-hidden="true" />
          {pending ? "Working…" : "Submit for approval"}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" onClick={() => run("approve", "Proposal approved.")} disabled={pending}>
          <ThumbsUp aria-hidden="true" />
          {pending ? "Working…" : "Approve"}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" onClick={() => setRejecting(true)} disabled={pending}>
          <ThumbsDown aria-hidden="true" />
          Reject
        </Button>
      ) : null}

      {may.canMarkSent ? (
        <Button size="sm" onClick={() => run("mark-sent", "Proposal marked as sent.")} disabled={pending}>
          <Send aria-hidden="true" />
          Mark sent
        </Button>
      ) : null}

      {may.canAccept ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            setConfirming({
              action: "accept",
              title: "Record this proposal as accepted?",
              description:
                "It becomes the deal the client agreed to and can no longer be edited or cancelled. The opportunity moves to Negotiation; winning it stays a separate decision.",
              confirmLabel: "Record as accepted",
              success: "Proposal accepted.",
            })
          }
        >
          <ThumbsUp aria-hidden="true" />
          Accepted
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
              title: "Record this proposal as declined?",
              description: "The client turned it down. You can raise a new proposal on the same opportunity.",
              confirmLabel: "Record as declined",
              success: "Proposal declined.",
            })
          }
        >
          <ThumbsDown aria-hidden="true" />
          Declined
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
              title: "Cancel this proposal?",
              description: "It stops standing. It stays visible with its approval history.",
              confirmLabel: "Cancel proposal",
              success: "Proposal cancelled.",
            })
          }
        >
          <Ban aria-hidden="true" />
          Cancel
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
              title: "Archive this proposal?",
              description: "It leaves the working list. Restoring it returns it to the status it holds now.",
              confirmLabel: "Archive proposal",
              success: "Proposal archived.",
            })
          }
        >
          <Archive aria-hidden="true" />
          Archive
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("restore", "Proposal restored.")}
          disabled={pending}
        >
          <RotateCcw aria-hidden="true" />
          Restore
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming?.title ?? ""}
        description={confirming?.description ?? ""}
        confirmLabel={confirming?.confirmLabel ?? "Confirm"}
        destructive={confirming?.action === "cancel"}
        pending={pending}
        onConfirm={() => {
          if (confirming) run(confirming.action, confirming.success);
        }}
      />

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject this proposal?"
        description="The reason is recorded against the approval and shown to whoever submitted the price."
        placeholder="What needs to change before this price can go to the client?"
        onReject={async (reason) => {
          const result = await rejectProposalAction(proposal.id, reason);
          if (result.ok) {
            toast({ title: "Proposal rejected." });
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
