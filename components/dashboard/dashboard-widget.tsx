import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { BarChart } from "@/components/charts/bar-chart";
import { Donut } from "@/components/charts/donut";
import { ProgressBar } from "@/components/charts/progress-bar";
import { widgetSpanClasses } from "@/components/dashboard/dashboard-grid";
import { Badge } from "@/components/ui/badge";
import type { Tone, WidgetDefinition } from "@/config/dashboards";
import { cn } from "@/lib/utils/cn";

const badgeTone: Record<Tone, "default" | "success" | "warning" | "danger" | "info"> = {
  default: "default",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

function ListRows({ widget }: { widget: Extract<WidgetDefinition, { type: "list" }> }) {
  return (
    <ul className="divide-y divide-line">
      {widget.rows.map((row, index) => (
        <li key={index} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-table font-medium text-fg">{row.label}</p>
            {row.meta ? <p className="truncate text-meta text-fg-muted">{row.meta}</p> : null}
          </div>
          {row.badge ? (
            <Badge tone={badgeTone[row.tone ?? "default"]}>{row.badge}</Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ProgressRows({ widget }: { widget: Extract<WidgetDefinition, { type: "progress" }> }) {
  return (
    <div className="space-y-3.5">
      {widget.rows.map((row, index) => (
        <div key={index}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <p className="truncate text-table font-medium text-fg">{row.label}</p>
            <p className="shrink-0 text-meta tabular-nums text-fg-muted">{row.percent}%</p>
          </div>
          <ProgressBar
            value={row.percent}
            label={row.label}
            tone={row.percent < 35 ? "warning" : "default"}
          />
          {row.meta ? <p className="mt-1 text-meta text-fg-subtle">{row.meta}</p> : null}
        </div>
      ))}
    </div>
  );
}

function BreakdownRows({ widget }: { widget: Extract<WidgetDefinition, { type: "breakdown" }> }) {
  return (
    <dl className="divide-y divide-line">
      {widget.rows.map((row, index) => (
        <div key={index} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <dt className="truncate text-table text-fg-muted">{row.label}</dt>
          <dd
            className={cn(
              "shrink-0 text-table font-semibold tabular-nums text-fg",
              row.tone === "success" && "text-success-strong",
              row.tone === "warning" && "text-warning-strong",
              row.tone === "danger" && "text-danger-strong",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BarRows({ widget }: { widget: Extract<WidgetDefinition, { type: "bars" }> }) {
  return (
    <BarChart
      caption={widget.title}
      data={widget.rows.map((row) => ({
        label: row.label,
        value: row.value,
        display: row.display,
      }))}
    />
  );
}

function ShareRows({ widget }: { widget: Extract<WidgetDefinition, { type: "share" }> }) {
  return (
    <Donut
      caption={widget.title}
      slices={widget.rows.map((row) => ({ label: row.label, value: row.value }))}
      centerValue={widget.total}
    />
  );
}

function ActivityRows({ widget }: { widget: Extract<WidgetDefinition, { type: "activity" }> }) {
  return (
    <ol className="divide-y divide-line">
      {widget.rows.map((row, index) => (
        <li key={index} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
          <span
            aria-hidden="true"
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong"
          />
          <p className="min-w-0 flex-1 text-table leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{row.actor}</span> {row.action}
            {row.target ? <span className="font-medium text-fg"> {row.target}</span> : null}
          </p>
          <span className="shrink-0 whitespace-nowrap text-meta text-fg-subtle">{row.time}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Renders any widget from the catalogue. Roles never bring their own widget
 * components — they select keys, and this renders them (spec §51).
 */
export function DashboardWidget({ widget }: { widget: WidgetDefinition }) {
  return (
    <section className={cn("nesto-card flex flex-col p-5", widgetSpanClasses[widget.span])}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-card font-semibold text-fg">{widget.title}</h3>
          {widget.description ? (
            <p className="mt-0.5 text-meta text-fg-muted">{widget.description}</p>
          ) : null}
        </div>
        {widget.href ? (
          <Link
            href={widget.href}
            className="inline-flex shrink-0 items-center gap-0.5 text-meta font-medium text-fg-muted transition-colors hover:text-accent"
          >
            View
            <ChevronRight className="size-3.5" />
          </Link>
        ) : null}
      </div>

      <div className="flex-1">
        {widget.type === "list" ? <ListRows widget={widget} /> : null}
        {widget.type === "progress" ? <ProgressRows widget={widget} /> : null}
        {widget.type === "breakdown" ? <BreakdownRows widget={widget} /> : null}
        {widget.type === "bars" ? <BarRows widget={widget} /> : null}
        {widget.type === "activity" ? <ActivityRows widget={widget} /> : null}
        {widget.type === "share" ? <ShareRows widget={widget} /> : null}
      </div>
    </section>
  );
}
