import Link from "@/components/navigation/nav-link";

import { getIcon } from "@/components/layout/nav-icon";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import type { ResolvedKpi } from "@/lib/modules/dashboard/dashboard.types";
import { cn } from "@/lib/utils/cn";

/**
 * A single KPI card (PRD #4 §16).
 *
 * Label, figure, and a route into the records behind it. Values are resolved
 * server-side against the user's own scope, so the same card shows a Project
 * Manager their projects and an Owner the company's (PRD #4 §20).
 *
 * A figure summed across the group's companies carries "View by company": each
 * company's own number, and following one enters that company and goes to the
 * records behind the card (Workspace Context §73, §74).
 */
export function KpiCard({ kpi }: { kpi: ResolvedKpi }) {
  const Icon = getIcon(kpi.definition.icon);

  const body = (
    <>
      <div className="flex items-center gap-2.5 md:gap-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong md:size-9"
        >
          <Icon className="size-4" />
        </span>
        <p className="min-w-0 truncate text-table font-medium text-fg-muted">
          {kpi.definition.label}
        </p>
      </div>

      <p className="mt-3 text-page font-semibold tabular-nums text-fg md:mt-4">{kpi.value}</p>
      {kpi.hint ? <p className="mt-1 text-meta text-fg-subtle">{kpi.hint}</p> : null}
    </>
  );

  const breakdown = kpi.breakdown && kpi.breakdown.length > 1 ? kpi.breakdown : null;
  const href = kpi.definition.href;

  if (breakdown) {
    return (
      <div className="nesto-card p-4 md:p-5" data-testid="kpi-by-company">
        {href ? (
          <Link navSource="dashboard" href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
            {body}
          </Link>
        ) : (
          body
        )}
        <details className="mt-3 border-t border-line pt-2">
          <summary className="cursor-pointer text-meta font-medium text-accent-strong">View by company</summary>
          <ul className="mt-2 space-y-1">
            {breakdown.map((row) => (
              <li key={row.companyId} className="flex items-baseline justify-between gap-3 text-meta">
                {href ? (
                  <CompanyRecordLink companyId={row.companyId} companyName={row.company} href={href} className="truncate text-fg-muted transition-colors hover:text-accent">
                    {row.company}
                  </CompanyRecordLink>
                ) : (
                  <span className="truncate text-fg-muted">{row.company}</span>
                )}
                <span className="shrink-0 font-medium tabular-nums text-fg">{row.value}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  }

  if (!href) {
    return <div className="nesto-card p-4 md:p-5">{body}</div>;
  }

  return (
    <Link navSource="dashboard"
      href={href}
      className={cn(
        "nesto-card block p-4 transition-colors hover:border-line-strong md:p-5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
      )}
    >
      {body}
    </Link>
  );
}
