import Link from "next/link";

import { getIcon } from "@/components/layout/nav-icon";
import type { ResolvedKpi } from "@/lib/modules/dashboard/dashboard.types";
import { cn } from "@/lib/utils/cn";

/**
 * A single KPI card (PRD #4 §16).
 *
 * Label, figure, and a route into the records behind it. Values are resolved
 * server-side against the user's own scope, so the same card shows a Project
 * Manager their projects and an Owner the company's (PRD #4 §20).
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

  if (!kpi.definition.href) {
    return <div className="nesto-card p-4 md:p-5">{body}</div>;
  }

  return (
    <Link
      href={kpi.definition.href}
      className={cn(
        "nesto-card block p-4 transition-colors hover:border-line-strong md:p-5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
      )}
    >
      {body}
    </Link>
  );
}
