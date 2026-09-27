import Link from "@/components/navigation/nav-link";

import type { ContractOverviewDTO } from "@/lib/modules/contracts/contract.types";
import { getTranslations } from "@/lib/i18n/server";
import { totalsLabel } from "./contract-format";

/**
 * The Legal overview KPI row (PRD #18 §32–§34, §300).
 *
 * Every figure comes from the same scope clause the lists use, so a project
 * manager's "active contracts" counts the agreements on their projects. A KPI
 * computed from a wider query than the list beneath it is a leak with a number
 * on it.
 */
export async function ContractKpiGrid({ overview }: { overview: ContractOverviewDTO }) {
  const t = await getTranslations("contracts");
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.contracts) {
    cards.push({
      label: t("kpis.activeContracts"),
      value: String(overview.activeContracts),
      href: "/contracts/active",
    });
    cards.push({
      label: t("kpis.expiringIn30"),
      value: String(overview.expiringIn30Days),
      hint: t("kpis.within90", { count: overview.expiringIn90Days }),
      href: "/contracts/expiring?within=30",
    });
    cards.push({
      label: t("kpis.inReview"),
      value: String(overview.pendingReview),
      hint: t("kpis.awaitingApproval", { count: overview.pendingApproval }),
      href: "/contracts/review",
    });
    cards.push({
      label: t("kpis.sentNotSigned"),
      value: String(overview.sentNotSigned),
      hint: t("kpis.approvedNotSent", { count: overview.approvedNotSent }),
      href: "/contracts/all?status=SENT",
    });
  }

  if (overview.visible.commercial && overview.activeValue) {
    cards.push({
      label: t("kpis.activeValue"),
      value: totalsLabel(overview.activeValue),
      hint: t("kpis.activeValueHint"),
      href: "/contracts/reports",
    });
  }

  if (overview.visible.obligations) {
    cards.push({
      label: t("kpis.openObligations"),
      value: String(overview.openObligations),
      hint:
        overview.overdueObligations > 0
          ? t("kpis.overdue", { count: overview.overdueObligations })
          : t("kpis.noneOverdue"),
      href: "/contracts/reports",
    });
  }

  if (overview.visible.approvals) {
    cards.push({
      label: t("kpis.awaitingDecision"),
      value: String(overview.pendingApproval),
      href: "/contracts/approvals",
    });
  }

  if (overview.visible.contracts) {
    cards.push({
      label: t("kpis.renewalNoticeDue"),
      value: String(overview.renewalNoticeDue),
      hint: t("kpis.terminatedThisYear", { count: overview.terminatedThisYear }),
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
            key={card.href}
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
