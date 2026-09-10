import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { getIcon } from "@/components/layout/nav-icon";
import type { KpiDefinition } from "@/config/dashboards";
import { cn } from "@/lib/utils/cn";

const toneStyles = {
  default: "bg-hover text-fg-muted",
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

/** A single KPI card (spec §13; design spec §19, §58). */
export function KpiCard({ kpi }: { kpi: KpiDefinition }) {
  const Icon = getIcon(kpi.icon);
  const TrendIcon = kpi.trend ? trendIcons[kpi.trend.direction] : null;

  return (
    <div className="nesto-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-table font-medium text-fg-muted">{kpi.label}</p>
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md",
            toneStyles[kpi.tone ?? "default"],
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>

      <p className="mt-3 text-page font-semibold text-fg tabular-nums">{kpi.value}</p>

      <div className="mt-1.5 flex items-center gap-2 text-meta">
        {kpi.trend && TrendIcon ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              kpi.trend.direction === "up" && "text-success-strong",
              kpi.trend.direction === "down" && "text-danger-strong",
              kpi.trend.direction === "flat" && "text-fg-muted",
            )}
          >
            <TrendIcon className="size-3.5" />
            {kpi.trend.value}
          </span>
        ) : null}
        {kpi.hint ? <span className="truncate text-fg-subtle">{kpi.hint}</span> : null}
      </div>

      {kpi.series ? (
        <Sparkline
          points={kpi.series}
          caption={`${kpi.label} trend`}
          tone={kpi.trend?.direction === "down" ? "danger" : "success"}
          className="mt-3 h-7 w-full"
        />
      ) : null}
    </div>
  );
}
