import { ArrowRight } from "lucide-react";

import { FittedRows } from "@/components/dashboard/fitted-rows";
import Link from "@/components/navigation/nav-link";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserContext } from "@/lib/context/types";
import { getTranslations } from "@/lib/i18n/server";
import { loadPlannedKpi, loadPlannedWidget, type DashboardPlan } from "@/lib/modules/dashboard/dashboard.service";
import { kpiLabel, widgetText } from "./config-text";

/**
 * Pending Approvals, beside the dashboard's heading and under My Day.
 *
 * Drawn on the accent colour (the wrapper's `nesto-on-accent`), and never
 * taller than the heading beside it: the heading's own height is the height of
 * the whole row, so this card takes what My Day leaves and shows the approvals
 * that fit, whole. When some are left out — or the list is only the first few —
 * a small "Show all pending approvals" leads to the Approvals module.
 *
 * Two readings of the same thing, whichever the reader's plan has: the list of
 * what waits on them in a company, or the group's count across its companies.
 */

/** The Approvals Center's own widget query asks for this many (dashboard.service `loadApprovals`). */
const LIST_LIMIT = 5;

const card = "nesto-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 py-2.5 lg:py-2";

function ShowAll({ href, label }: { href: string; label: string }) {
  return (
    <Link navSource="dashboard" href={href} className="mt-0.5 inline-flex items-center gap-1 text-micro font-medium text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline" data-testid="show-all-approvals">
      {label}
      <ArrowRight aria-hidden="true" className="size-3" />
    </Link>
  );
}

/** In a company: the approvals waiting on this reader, most urgent first. */
export async function PendingApprovalsList({ context, definition }: { context: UserContext; definition: DashboardPlan["widgets"][number] }) {
  const t = await getTranslations("dashboard");
  const { payload } = await loadPlannedWidget(context, definition);
  const title = widgetText(t, definition.key, "title", definition.title);
  const href = definition.href ?? "/approvals";
  const items = payload.kind === "approvals" ? payload.items : [];
  const incomplete = "incomplete" in payload ? payload.incomplete : undefined;

  return (
    <section className={card} aria-labelledby={`widget-${definition.key}`}>
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <h2 id={`widget-${definition.key}`} className="truncate text-body font-semibold leading-5 text-fg">
          {title}
        </h2>
        {payload.kind === "approvals" && items.length > 0 ? (
          <span className="shrink-0 text-meta font-semibold tabular-nums text-fg" data-testid="approvals-count">
            {/* The list is the first few; at its limit there may be more, and the count says so. */}
            {items.length >= LIST_LIMIT ? `${items.length}+` : items.length}
          </span>
        ) : null}
      </div>

      {payload.kind === "error" ? (
        <p className="mt-1 text-meta text-fg-muted">{t("loadFailed")}</p>
      ) : items.length === 0 ? (
        // A source that could not be read is said, and never shown as "nothing here" (AUD-10 §4, CW-03).
        <p className="mt-1 text-meta text-fg-muted" data-testid={incomplete ? "widget-incomplete" : undefined}>
          {incomplete ?? widgetText(t, definition.key, "emptyMessage", definition.emptyMessage)}
        </p>
      ) : (
        <FittedRows className="mt-1" always={items.length >= LIST_LIMIT || Boolean(incomplete)} more={<ShowAll href={href} label={t("showAllApprovals")} />}>
          {items.map((item) => (
            <li key={item.id} className="w-full min-w-0">
              <Link navSource="dashboard" href={item.href} className="group block truncate py-0.5 text-table leading-[1.125rem] text-fg">
                <span className="font-medium underline-offset-2 group-hover:underline">{item.title}</span>
                {item.subtitle ? <span className="text-fg-subtle"> · {item.subtitle}</span> : null}
              </Link>
            </li>
          ))}
        </FittedRows>
      )}
    </section>
  );
}

/** In the Group workspace: how many wait across the group's companies. */
export async function PendingApprovalsFigure({ context, definition }: { context: UserContext; definition: DashboardPlan["kpis"][number] }) {
  const t = await getTranslations("dashboard");
  const kpi = await loadPlannedKpi(context, definition);
  // Nothing behind a group figure for this reader: the card is left out (D-01 §66).
  if (!kpi) return null;
  const href = kpi.definition.href ?? "/approvals";

  return (
    <section className={card} aria-labelledby={`kpi-${definition.key}`}>
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <h2 id={`kpi-${definition.key}`} className="truncate text-body font-semibold leading-5 text-fg">
          {kpiLabel(t, kpi.definition.key, kpi.definition.label)}
        </h2>
        <span className="shrink-0 font-serif text-[1.625rem] leading-none tabular-nums text-fg" data-testid="approvals-count">
          {kpi.value}
        </span>
      </div>
      {/* An incomplete figure says so in its hint, never passing for a whole count (AUD-10 §4, CW-03). */}
      {kpi.hint ? (
        <p className="mt-1 truncate text-meta text-fg-subtle" title={kpi.hint} data-testid={kpi.incomplete ? "kpi-incomplete" : undefined}>
          {kpi.hint}
        </p>
      ) : null}
      <div className="mt-auto shrink-0">
        <ShowAll href={href} label={t("showAllApprovals")} />
      </div>
    </section>
  );
}

export function PendingApprovalsSkeleton({ title }: { title: string }) {
  return (
    <section aria-busy="true" className={card} data-testid="section-skeleton">
      <h2 className="truncate text-body font-semibold leading-5 text-fg">{title}</h2>
      <div aria-hidden="true" className="mt-2 space-y-2">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </section>
  );
}
