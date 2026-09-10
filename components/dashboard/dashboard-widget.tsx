import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BarChart } from "@/components/charts/bar-chart";
import { Donut } from "@/components/charts/donut";
import { ProgressBar } from "@/components/charts/progress-bar";
import { BrandFeatureCard } from "@/components/dashboard/brand-feature-card";
import { widgetSpanClasses } from "@/components/dashboard/dashboard-grid";
import { getIcon } from "@/components/layout/nav-icon";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { activityMark, type Tone, type WidgetDefinition } from "@/config/dashboards";
import { cn } from "@/lib/utils/cn";

const badgeTone: Record<Tone, "default" | "success" | "warning" | "danger" | "info"> = {
  default: "default",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

/** Soft grounds for the round icon on an activity row and a KPI-style tile. */
const iconTone: Record<Tone, string> = {
  default: "bg-hover text-fg-muted",
  success: "bg-success-soft text-success-strong",
  warning: "bg-warning-soft text-warning-strong",
  danger: "bg-danger-soft text-danger-strong",
  info: "bg-info-soft text-info-strong",
};

const dotTone: Record<Tone, string> = {
  default: "bg-fg-subtle",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
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
      centerLabel={widget.totalLabel}
    />
  );
}

/** The executive overview table (design spec §21, §73). */
function ProjectRows({ widget }: { widget: Extract<WidgetDefinition, { type: "projects" }> }) {
  return (
    <Table flush>
      <TableHead>
        <TableRow className="hover:bg-transparent">
          <TableHeaderCell className="w-16">Code</TableHeaderCell>
          <TableHeaderCell>Project</TableHeaderCell>
          {/*
            * Column priority (§79). Status and progress are the point of the
            * widget and never leave. The due date returns at 1200px and the
            * client at 1440px, which is where the card is actually wide enough
            * for them — the alternative is a header the reader has to scroll
            * sideways to finish reading.
            */}
          <TableHeaderCell className="hidden 2xl:table-cell">Client</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className="w-24">Progress</TableHeaderCell>
          <TableHeaderCell className="hidden whitespace-nowrap text-right xl:table-cell">
            Due
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {widget.rows.map((row) => (
          <TableRow key={row.code}>
            <TableCell className="whitespace-nowrap text-meta tabular-nums text-fg-subtle">
              {row.code}
            </TableCell>
            <TableCell className="font-medium">
              <span className="block max-w-[10rem] truncate 2xl:max-w-[12rem]">{row.name}</span>
            </TableCell>
            <TableCell className="hidden text-fg-muted 2xl:table-cell">
              <span className="block max-w-[9rem] truncate">{row.client}</span>
            </TableCell>
            <TableCell>
              <Badge tone={badgeTone[row.tone ?? "default"]}>{row.status}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-meta tabular-nums text-fg-muted">
                  {row.progress}%
                </span>
                <ProgressBar
                  value={row.progress}
                  label={`${row.name} progress`}
                  className="min-w-10"
                />
              </div>
            </TableCell>
            <TableCell className="hidden whitespace-nowrap text-right text-fg-muted xl:table-cell">
              {row.due}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Department workload (design spec §73). */
function DepartmentRows({
  widget,
}: {
  widget: Extract<WidgetDefinition, { type: "departments" }>;
}) {
  return (
    <Table flush>
      <TableHead>
        <TableRow className="hover:bg-transparent">
          <TableHeaderCell>Department</TableHeaderCell>
          <TableHeaderCell className="hidden whitespace-nowrap text-right sm:table-cell">
            Team
          </TableHeaderCell>
          <TableHeaderCell className="hidden whitespace-nowrap text-right sm:table-cell">
            Active
          </TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className="w-24">Utilisation</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {widget.rows.map((row) => {
          const Icon = getIcon(row.icon);
          const tone = row.tone ?? "default";

          return (
            <TableRow key={row.label}>
              <TableCell>
                <span className="flex items-center gap-2.5">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                  <span className="block max-w-[10rem] truncate font-medium">{row.label}</span>
                </span>
              </TableCell>
              <TableCell className="hidden text-right tabular-nums text-fg-muted sm:table-cell">
                {row.teamSize}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums text-fg-muted sm:table-cell">
                {row.activeItems}
              </TableCell>
              <TableCell>
                {/* Dot plus word — §56 rules out communicating status by colour alone. */}
                <span className="flex items-center gap-2 whitespace-nowrap text-fg-muted">
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full", dotTone[tone])}
                  />
                  {row.status}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-meta tabular-nums text-fg-muted">
                    {row.utilisation}%
                  </span>
                  <ProgressBar
                    value={row.utilisation}
                    label={`${row.label} utilisation`}
                    tone={row.utilisation >= 80 ? "warning" : "default"}
                    className="min-w-10"
                  />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ActivityRows({ widget }: { widget: Extract<WidgetDefinition, { type: "activity" }> }) {
  return (
    <ol className="space-y-1">
      {widget.rows.map((row, index) => {
        const mark = activityMark(row.action);
        const Icon = getIcon(mark.icon);

        return (
          <li key={index} className="flex items-start gap-3 py-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                iconTone[mark.tone],
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-table font-medium text-fg">{row.actor}</p>
              <p className="line-clamp-2 text-meta text-fg-muted">
                {row.action}
                {row.target ? ` ${row.target}` : ""}
              </p>
            </div>
            <span className="shrink-0 whitespace-nowrap text-meta text-fg-subtle">{row.time}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Renders any widget from the catalogue. Roles never bring their own widget
 * components — they select keys, and this renders them (spec §51).
 */
export function DashboardWidget({ widget }: { widget: WidgetDefinition }) {
  /* The brand card supplies its own surface, so it skips the card chrome. */
  if (widget.type === "feature") {
    return (
      <div className={cn("min-w-0", widgetSpanClasses[widget.span])}>
        <BrandFeatureCard />
      </div>
    );
  }

  return (
    /* min-w-0: a grid item defaults to min-width:auto, so without this a card
       containing a table grows to the table's intrinsic width and pushes the
       whole page sideways instead of letting the table scroll inside it (§79). */
    <section
      className={cn("nesto-card flex min-w-0 flex-col p-5", widgetSpanClasses[widget.span])}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-card font-semibold text-fg">{widget.title}</h3>
          {widget.description ? (
            <p className="mt-0.5 text-meta text-fg-muted">{widget.description}</p>
          ) : null}
        </div>
        {widget.href ? (
          <Link
            href={widget.href}
            className="group inline-flex shrink-0 items-center gap-1 text-meta font-medium text-accent-strong transition-colors hover:text-accent"
          >
            View all
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {widget.type === "list" ? <ListRows widget={widget} /> : null}
        {widget.type === "progress" ? <ProgressRows widget={widget} /> : null}
        {widget.type === "breakdown" ? <BreakdownRows widget={widget} /> : null}
        {widget.type === "bars" ? <BarRows widget={widget} /> : null}
        {widget.type === "activity" ? <ActivityRows widget={widget} /> : null}
        {widget.type === "share" ? <ShareRows widget={widget} /> : null}
        {widget.type === "projects" ? <ProjectRows widget={widget} /> : null}
        {widget.type === "departments" ? <DepartmentRows widget={widget} /> : null}
      </div>
    </section>
  );
}
