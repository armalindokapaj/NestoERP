import Link from "@/components/navigation/nav-link";

import type { ContractOverviewDTO } from "@/lib/modules/contracts/contract.types";
import { totalsLabel } from "./contract-format";

/**
 * The Legal overview KPI row (PRD #18 §32–§34, §300).
 *
 * Every figure comes from the same scope clause the lists use, so a project
 * manager's "active contracts" counts the agreements on their projects. A KPI
 * computed from a wider query than the list beneath it is a leak with a number
 * on it.
 */
export function ContractKpiGrid({ overview }: { overview: ContractOverviewDTO }) {
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.contracts) {
    cards.push({
      label: "Active contracts",
      value: String(overview.activeContracts),
      href: "/contracts/active",
    });
    cards.push({
      label: "Expiring in 30 days",
      value: String(overview.expiringIn30Days),
      hint: `${overview.expiringIn90Days} within 90 days`,
      href: "/contracts/expiring?within=30",
    });
    cards.push({
      label: "In review",
      value: String(overview.pendingReview),
      hint: `${overview.pendingApproval} awaiting approval`,
      href: "/contracts/review",
    });
    cards.push({
      label: "Sent, not signed",
      value: String(overview.sentNotSigned),
      hint: `${overview.approvedNotSent} approved and not yet sent`,
      href: "/contracts/all?status=SENT",
    });
  }

  if (overview.visible.commercial && overview.activeValue) {
    cards.push({
      label: "Active contract value",
      value: totalsLabel(overview.activeValue),
      hint: "Grouped by currency, never summed across them",
      href: "/contracts/reports",
    });
  }

  if (overview.visible.obligations) {
    cards.push({
      label: "Open obligations",
      value: String(overview.openObligations),
      hint:
        overview.overdueObligations > 0
          ? `${overview.overdueObligations} overdue`
          : "None overdue",
      href: "/contracts/reports",
    });
  }

  if (overview.visible.approvals) {
    cards.push({
      label: "Awaiting a decision",
      value: String(overview.pendingApproval),
      href: "/contracts/approvals",
    });
  }

  if (overview.visible.contracts) {
    cards.push({
      label: "Renewal notice due",
      value: String(overview.renewalNoticeDue),
      hint: `${overview.terminatedThisYear} terminated this year`,
      href: "/contracts/expiring",
    });
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const body = (
          <>
            <p className="text-table text-fg-muted">{card.label}</p>
            <p className="mt-2 text-card font-semibold tabular-nums text-fg">{card.value}</p>
            {card.hint ? <p className="mt-1 text-meta text-fg-subtle">{card.hint}</p> : null}
          </>
        );

        return card.href ? (
          <Link
            key={card.label}
            href={card.href}
            className="nesto-card p-4 transition-colors hover:border-line-strong"
          >
            {body}
          </Link>
        ) : (
          <div key={card.label} className="nesto-card p-4">
            {body}
          </div>
        );
      })}
    </div>
  );
}
