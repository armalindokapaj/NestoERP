import Link from "@/components/navigation/nav-link";

import { getIcon } from "@/components/layout/nav-icon";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import type { ResolvedKpi } from "@/lib/modules/dashboard/dashboard.types";
import { cn } from "@/lib/utils/cn";
import { getTranslations } from "@/lib/i18n/server";
import { kpiLabel } from "./config-text";
import { rowText } from "./row-text";

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
export async function KpiCard({ kpi }: { kpi: ResolvedKpi }) {
  const t = await getTranslations("dashboard");
  const Icon = getIcon(kpi.definition.icon);

  const body = (
    <>
      {/* Theme 2: the reference's figure — the number first, its name under it in mono capitals, no icon tile. */}
      <div className="flex items-center gap-2.5 md:gap-3 look2:mt-2">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong md:size-9 look2:hidden"
        >
          <Icon className="size-4" strokeWidth={1.6} />
        </span>
        {/* Two lines, not an ellipsis: a 2-up phone grid leaves ~90px for "Open Quality Items" (AUD-04 §4, MW-01). */}
        <p className="line-clamp-2 min-w-0 break-words text-table font-medium text-fg-muted look2:font-mono look2:text-micro look2:uppercase look2:tracking-[0.1em]">
          {kpiLabel(t, kpi.definition.key, kpi.definition.label)}
        </p>
      </div>

      {/* Version 2: the 30/36 dashboard metric (UI-02 §6.2). */}
      <p className="mt-3 font-serif font-normal look2:font-display text-display tabular-nums text-fg md:mt-4 look2:order-first look2:mt-0 look2:text-[2.75rem] look2:leading-none look2:[font-variation-settings:'wdth'_70]">{kpi.value}</p>
      {/* An incomplete figure says so in its hint, never passing for a whole count (AUD-10 §4, CW-03). */}
      {kpi.hint ? <p className={cn("mt-1 text-meta", kpi.incomplete ? "text-warning-strong" : "text-fg-subtle")} data-testid={kpi.incomplete ? "kpi-incomplete" : undefined}>{rowText(t, kpi.hint)}</p> : null}
    </>
  );

  const breakdown = kpi.breakdown && kpi.breakdown.length > 1 ? kpi.breakdown : null;
  const href = kpi.definition.href;

  if (breakdown) {
    return (
      <div className="nesto-card relative before:absolute before:left-4 before:top-0 before:h-0.5 before:w-8 before:bg-accent before:content-[''] md:before:left-5 p-4 md:p-5 look2:flex look2:flex-col" data-testid="kpi-by-company">
        {href ? (
          <Link navSource="dashboard" href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 look2:flex look2:flex-col">
            {body}
          </Link>
        ) : (
          body
        )}
        <details className="mt-3 border-t border-line pt-2">
          <summary className="tap-target cursor-pointer text-meta font-medium text-accent-strong">{t("viewByCompany")}</summary>
          {/* Under touch each company's row is its link's target (tap-row), the rows far enough apart to be 24px each. */}
          <ul className="mt-2 space-y-1 touch:space-y-2 [--tap-row-bleed:0.25rem]">
            {breakdown.map((row) => (
              <li key={row.companyId} className="relative flex items-baseline justify-between gap-3 text-meta">
                {href ? (
                  <CompanyRecordLink companyId={row.companyId} companyName={row.company} href={href} className="tap-row truncate text-fg-muted transition-colors hover:text-accent">
                    {row.company}
                  </CompanyRecordLink>
                ) : (
                  <span className="truncate text-fg-muted">{row.company}</span>
                )}
                <span className="shrink-0 font-medium tabular-nums text-fg" title={row.incomplete ? t("partNotLoaded") : undefined}>
                  {row.incomplete ? (row.value > 0 ? `${row.value}+` : "—") : row.value}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  }

  if (!href) {
    return <div className="nesto-card relative before:absolute before:left-4 before:top-0 before:h-0.5 before:w-8 before:bg-accent before:content-[''] md:before:left-5 p-4 md:p-5 look2:flex look2:flex-col">{body}</div>;
  }

  return (
    <Link navSource="dashboard"
      href={href}
      className={cn(
        "nesto-card relative before:absolute before:left-4 before:top-0 before:h-0.5 before:w-8 before:bg-accent before:content-[''] md:before:left-5 block p-4 transition-colors hover:border-line-strong md:p-5 look2:flex look2:flex-col",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
      )}
    >
      {body}
    </Link>
  );
}
