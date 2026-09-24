import Link from "@/components/navigation/nav-link";

import type { QaqcOverviewDTO } from "@/lib/modules/qaqc/qaqc.types";

/**
 * The QA/QC KPI row (PRD #21 §31, §33).
 *
 * A card appears only when the reader may see what it counts. A zero where a
 * permission is missing would be a claim about the world rather than about
 * their access.
 *
 * The pass rate shows "—" rather than 0% when nothing has been decided: a
 * quality metric computed from no decisions is worse than no metric (§193).
 */
export function QaqcKpiGrid({ overview }: { overview: QaqcOverviewDTO }) {
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.inspections) {
    cards.push({
      label: "Pass rate",
      value: overview.passRate ? `${overview.passRate.percent}%` : "—",
      hint: overview.passRate
        ? `${overview.passRate.passed} of ${overview.passRate.total} decided`
        : "Nothing decided yet",
      href: "/qaqc/reports",
    });
    cards.push({
      label: "Inspections open",
      value: String(overview.inspectionsInProgress),
      hint: `${overview.awaitingApproval} awaiting approval`,
      href: "/qaqc/inspections?view=open",
    });
  }

  if (overview.visible.requests) {
    cards.push({
      label: "Requests open",
      value: String(overview.openRequests),
      hint:
        overview.unassignedRequests > 0
          ? `${overview.unassignedRequests} not yet assigned`
          : "All assigned",
      href: "/qaqc/requests?view=open",
    });
  }

  if (overview.visible.defects) {
    cards.push({
      label: "Defects open",
      value: String(overview.openDefects),
      hint:
        overview.criticalDefects > 0
          ? `${overview.criticalDefects} high or critical`
          : "None serious",
      href: "/qaqc/defects?view=open",
    });
  }

  if (overview.visible.ncrs) {
    cards.push({
      label: "NCRs open",
      value: String(overview.openNcrs),
      hint: overview.overdueNcrs > 0 ? `${overview.overdueNcrs} past their date` : "All on time",
      href: "/qaqc/ncrs?view=open",
    });
  }

  if (overview.visible.actions) {
    cards.push({
      label: "Corrective actions",
      value: String(overview.openActions),
      hint:
        overview.overdueActions > 0
          ? `${overview.overdueActions} past their date`
          : "All on time",
      href: "/qaqc/corrective-actions?view=open",
    });
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const body = (
          <>
            <p className="nesto-eyebrow text-fg-subtle">{card.label}</p>
            <p className="mt-1.5 text-page font-semibold tabular-nums text-fg">{card.value}</p>
            {card.hint ? <p className="mt-1 text-meta text-fg-subtle">{card.hint}</p> : null}
          </>
        );

        return card.href ? (
          <Link
            key={card.label}
            href={card.href}
            className="nesto-card p-5 transition-colors hover:border-line-strong"
          >
            {body}
          </Link>
        ) : (
          <div key={card.label} className="nesto-card p-5">
            {body}
          </div>
        );
      })}
    </div>
  );
}
