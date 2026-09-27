import Link from "@/components/navigation/nav-link";

import { isGroupRoute } from "@/config/workspace";
import type { CurrencyTotal, SalesOverviewDTO } from "@/lib/modules/sales/sales.types";
import { getTranslations } from "@/lib/i18n/server";
import { totalsLabel, weightedTotalsLabel } from "./sales-format";

/**
 * The overview KPI row (PRD #17 §21–§24, §279, §412).
 *
 * Every figure comes from the same scope service the lists use, so an assigned
 * rep's "open pipeline" is their pipeline. A KPI computed from a wider query
 * than the list beneath it is a leak with a number on it (PRD #17 §412, §413).
 *
 * In the Group workspace (`grouped`) a card links only to a section the group
 * answers; one that would ask "choose a company" (proposals) is a plain figure
 * (Workspace Context §25, §29).
 */
export async function SalesKpiGrid({ overview, grouped = false }: { overview: SalesOverviewDTO; grouped?: boolean }) {
  const t = await getTranslations("sales");
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.opportunities) {
    cards.push({
      label: t("kpis.openPipeline"),
      value: totalsLabel(overview.openPipeline),
      hint: t("kpis.weighted", { amount: weightedTotalsLabel(overview.openPipeline) }),
      href: "/sales/pipeline",
    });
    cards.push({
      label: t("kpis.openOpportunities"),
      value: String(overview.openOpportunities),
      href: "/sales/opportunities?outcome=OPEN",
    });
    cards.push({
      label: t("kpis.expectedCloseThisMonth"),
      value: totalsLabel(overview.expectedCloseThisMonth),
      href: "/sales/reports?report=expected-close",
    });
    cards.push({
      label: t("kpis.wonThisMonth"),
      value: totalsLabel(overview.wonThisMonth),
      hint: overview.winRate === null ? t("kpis.noDealsClosed") : t("kpis.winRate", { rate: overview.winRate }),
      href: "/sales/opportunities?outcome=WON",
    });
  }

  if (overview.visible.leads) {
    cards.push({
      label: t("kpis.newLeadsThisMonth"),
      value: String(overview.newLeadsThisMonth),
      href: "/sales/leads",
    });
    cards.push({
      label: t("kpis.qualifiedLeads"),
      value: String(overview.qualifiedLeads),
      hint: t("kpis.waitingToBecome"),
      href: "/sales/leads?status=QUALIFIED",
    });
  }

  if (overview.visible.proposals) {
    cards.push({
      label: t("kpis.proposalsAwaiting"),
      value: String(overview.pendingProposalApprovals),
      href: "/sales/proposals?status=PENDING_APPROVAL",
    });
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const href = card.href && (!grouped || isGroupRoute("sales", card.href.split("?")[0])) ? card.href : undefined;
        const body = (
          <>
            <p className="text-table text-fg-muted">{card.label}</p>
            <p className="mt-2 text-card font-semibold tabular-nums text-fg">{card.value}</p>
            {card.hint ? <p className="mt-1 text-meta text-fg-subtle">{card.hint}</p> : null}
          </>
        );

        return href ? (
          <Link
            key={card.label}
            href={href}
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

/**
 * A currency-grouped figure, listed and never summed (PRD #17 §31, §172).
 */
export function CurrencyBreakdown({ totals }: { totals: CurrencyTotal[] }) {
  if (totals.length === 0) return <span className="text-fg-subtle">—</span>;

  return (
    <span className="flex flex-col gap-0.5">
      {totals.map((total) => (
        <span key={total.currency} className="tabular-nums">
          {total.value} {total.currency}
        </span>
      ))}
    </span>
  );
}
