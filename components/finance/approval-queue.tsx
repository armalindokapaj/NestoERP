"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Money } from "@/components/finance/money";
import { RejectDialog } from "@/components/finance/reject-dialog";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  budgetLifecycleAction,
  commitmentLifecycleAction,
  expenseLifecycleAction,
  invoiceLifecycleAction,
  rejectBudgetAction,
  rejectCommitmentAction,
  rejectExpenseAction,
  rejectInvoiceAction,
} from "@/lib/actions/finance";
import type { FinanceApprovalDTO } from "@/lib/modules/finance/finance.types";
import { formatDateTime } from "@/lib/utils/format";

/**
 * The approval queue (PRD #15 §141, §142, §305).
 *
 * Approve and Reject are offered only where the server said `canDecide` — which
 * already accounts for the self-approval rule, so somebody looking at their own
 * submission sees the record but no buttons. The services enforce it again
 * regardless (PRD #15 §19, §148).
 */
const ROUTES: Record<FinanceApprovalDTO["recordType"], string> = {
  INVOICE: "/finance/invoices",
  EXPENSE: "/finance/expenses",
  BUDGET: "/finance/budgets",
  COMMITMENT: "/finance/commitments",
};

const TYPE_LABELS: Record<FinanceApprovalDTO["recordType"], string> = {
  INVOICE: "Invoice",
  EXPENSE: "Expense",
  BUDGET: "Budget",
  COMMITMENT: "Commitment",
};

export function ApprovalQueue({ approvals }: { approvals: FinanceApprovalDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<FinanceApprovalDTO | null>(null);
  const [busy, startTransition] = React.useTransition();

  function approve(approval: FinanceApprovalDTO) {
    setPendingId(approval.id);
    startTransition(async () => {
      const result = await decide(approval, "approve");
      setPendingId(null);
      if (result.ok) {
        toast({ title: `${TYPE_LABELS[approval.recordType]} approved.`, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      <ul className="nesto-card divide-y divide-line">
        {approvals.map((approval) => {
          const rowBusy = busy && pendingId === approval.id;

          return (
            <li
              key={approval.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{TYPE_LABELS[approval.recordType]}</Badge>
                  <Link
                    href={`${ROUTES[approval.recordType]}/${approval.recordId}`}
                    className="truncate text-table font-medium text-fg hover:text-accent"
                  >
                    {approval.record.reference}
                  </Link>
                  <StatusBadge status={approval.status} />
                </div>

                <p className="mt-1 text-meta text-fg-subtle">
                  {approval.record.projectName ?? "Company-wide"}
                  {approval.record.counterpartyName
                    ? ` · ${approval.record.counterpartyName}`
                    : ""}
                </p>
                <p className="mt-0.5 text-meta text-fg-subtle">
                  Submitted by <PersonLink memberId={approval.submittedBy.memberId} name={approval.submittedBy.fullName} /> ·{" "}
                  {formatDateTime(approval.submittedAt)}
                </p>
                {approval.decision ? (
                  <p className="mt-0.5 text-meta text-fg-subtle">
                    Decided by <PersonLink memberId={approval.decision.memberId} name={approval.decision.fullName} /> ·{" "}
                    {formatDateTime(approval.decision.decidedAt)}
                    {approval.decision.note ? ` · ${approval.decision.note}` : ""}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <Money
                  amount={approval.record.amount}
                  currency={approval.record.currency}
                  emphasis
                />

                {approval.canDecide ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => approve(approval)} disabled={rowBusy}>
                      <ThumbsUp aria-hidden="true" />
                      {rowBusy ? "Working…" : "Approve"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setRejecting(approval)}
                      disabled={rowBusy}
                    >
                      <ThumbsDown aria-hidden="true" />
                      Reject
                    </Button>
                  </div>
                ) : approval.status === "PENDING" ? (
                  // Saying why the buttons are absent is more useful than
                  // silently omitting them (PRD #15 §19).
                  <span className="text-meta text-fg-subtle">Awaiting another approver</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <RejectDialog
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        title={rejecting ? `Reject ${rejecting.record.reference}?` : "Reject"}
        onReject={async (reason) => {
          if (!rejecting) return false;
          const result = await rejectFor(rejecting, reason);
          if (result.ok) {
            toast({ title: `${TYPE_LABELS[rejecting.recordType]} rejected.` });
            setRejecting(null);
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

function decide(approval: FinanceApprovalDTO, action: "approve") {
  switch (approval.recordType) {
    case "INVOICE":
      return invoiceLifecycleAction(approval.recordId, action);
    case "EXPENSE":
      return expenseLifecycleAction(approval.recordId, action);
    case "BUDGET":
      return budgetLifecycleAction(approval.recordId, action);
    case "COMMITMENT":
      return commitmentLifecycleAction(approval.recordId, action);
  }
}

function rejectFor(approval: FinanceApprovalDTO, reason: string) {
  switch (approval.recordType) {
    case "INVOICE":
      return rejectInvoiceAction(approval.recordId, reason);
    case "EXPENSE":
      return rejectExpenseAction(approval.recordId, reason);
    case "BUDGET":
      return rejectBudgetAction(approval.recordId, reason);
    case "COMMITMENT":
      return rejectCommitmentAction(approval.recordId, reason);
  }
}
