import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { MiniBars } from "@/components/charts/mini-bars";
import { Sparkline } from "@/components/charts/sparkline";
import { getIcon } from "@/components/layout/nav-icon";
import type { KpiDefinition } from "@/config/dashboards";
import { cn } from "@/lib/utils/cn";

const toneStyles = {
  default: "bg-accent-soft text-accent-strong",
  success: "bg-success-soft text-success-strong",
  warning: "bg-warning-soft text-warning-strong",
  danger: "bg-danger-soft text-danger-strong",
  info: "bg-info-soft text-info-strong",
};

const trendIcons = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
};

const trendStyles = {
  success: "text-success-strong",
  danger: "text-danger-strong",
  neutral: "text-fg-muted",
};

/**
 * A single KPI card (spec §13; design spec §19, §58).
 *
 * Icon and label, then the figure with at most one micro visual beside it,
 * then the change and the period it is measured against. The visual is hidden
 * on the narrowest column, where two cards sit side by side and the figure has
 * to win.
 */
export function KpiCard({ kpi }: { kpi: KpiDefinition }) {
  const Icon = getIcon(kpi.icon);
  const TrendIcon = kpi.trend ? trendIcons[kpi.trend.direction] : null;

  /* Direction is arithmetic; tone is meaning. A rise in open tasks is both a
     climb and a problem, so a card may state the two separately (§56). */
  const trendTone =
    kpi.trend?.tone ??
    (kpi.trend?.direction === "up"
      ? "success"
      : kpi.trend?.direction === "down"
        ? "danger"
        : "neutral");

  const chartTone = trendTone === "danger" ? "danger" : "default";

  return (
    <div className="nesto-card p-4 md:p-5">
      <div className="flex items-center gap-2.5 md:gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg md:size-9",
            toneStyles[kpi.tone ?? "default"],
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        {/*
          * break-words matters at the narrowest card: two cards abreast at
          * 360px leave roughly 50px for the label, which a single long word
          * cannot wrap into. It only engages when there is genuinely no room.
          */}
        <p className="min-w-0 flex-1 text-balance break-words text-table font-medium leading-tight text-fg">
          {kpi.label}
        </p>
      </div>

      <div className="mt-3.5 flex items-end justify-between gap-3 md:mt-4">
        <p className="text-page font-semibold tabular-nums leading-none text-fg">{kpi.value}</p>

        {kpi.series ? (
          <span className="hidden h-8 w-16 shrink-0 items-end justify-end md:flex xl:w-20">
            {kpi.chart === "bars" ? (
              <MiniBars
                points={kpi.series}
                caption={`${kpi.label} by period`}
                tone={chartTone}
                className="h-full"
              />
            ) : (
              <Sparkline
                points={kpi.series}
                caption={`${kpi.label} trend`}
                tone={chartTone}
                className="h-full w-full"
              />
            )}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta">
        {kpi.trend && TrendIcon ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 font-medium",
              trendStyles[trendTone],
            )}
          >
            <TrendIcon aria-hidden="true" className="size-3.5" />
            {kpi.trend.value}
          </span>
        ) : null}
        {kpi.trend?.label ?? kpi.hint ? (
          <span className="min-w-0 text-fg-subtle">{kpi.trend?.label ?? kpi.hint}</span>
        ) : null}
      </div>
    </div>
  );
}
