import Link from "@/components/navigation/nav-link";

import { getTranslations } from "@/lib/i18n/server";
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
export async function QaqcKpiGrid({ overview }: { overview: QaqcOverviewDTO }) {
  const t = await getTranslations("qaqc");
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.inspections) {
    cards.push({
      label: t("kpi.passRate"),
      value: overview.passRate ? `${overview.passRate.percent}%` : "—",
      hint: overview.passRate
        ? t("kpi.decided", { passed: overview.passRate.passed, total: overview.passRate.total })
        : t("kpi.nothingDecided"),
      href: "/qaqc/reports",
    });
    cards.push({
      label: t("kpi.inspectionsOpen"),
      value: String(overview.inspectionsInProgress),
      hint: t("kpi.awaitingApproval", { count: overview.awaitingApproval }),
      href: "/qaqc/inspections?view=open",
    });
  }

  if (overview.visible.requests) {
    cards.push({
      label: t("kpi.requestsOpen"),
      value: String(overview.openRequests),
      hint:
        overview.unassignedRequests > 0
          ? t("kpi.notAssigned", { count: overview.unassignedRequests })
          : t("kpi.allAssigned"),
      href: "/qaqc/requests?view=open",
    });
  }

  if (overview.visible.defects) {
    cards.push({
      label: t("kpi.defectsOpen"),
      value: String(overview.openDefects),
      hint:
        overview.criticalDefects > 0
          ? t("kpi.serious", { count: overview.criticalDefects })
          : t("kpi.noneSerious"),
      href: "/qaqc/defects?view=open",
    });
  }

  if (overview.visible.ncrs) {
    cards.push({
      label: t("kpi.ncrsOpen"),
      value: String(overview.openNcrs),
      hint: overview.overdueNcrs > 0 ? t("kpi.pastDate", { count: overview.overdueNcrs }) : t("kpi.allOnTime"),
      href: "/qaqc/ncrs?view=open",
    });
  }

  if (overview.visible.actions) {
    cards.push({
      label: t("kpi.correctiveActions"),
      value: String(overview.openActions),
      hint:
        overview.overdueActions > 0
          ? t("kpi.pastDate", { count: overview.overdueActions })
          : t("kpi.allOnTime"),
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
            key={card.href ?? card.label}
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
