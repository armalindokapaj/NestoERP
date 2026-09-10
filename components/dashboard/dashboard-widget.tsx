import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

import { StatusBadge } from "@/components/modules/status-badge";
import { widgetSpanClasses } from "@/components/dashboard/dashboard-grid";
import type { AlertPriority, ResolvedWidget } from "@/lib/modules/dashboard/dashboard.types";
import { cn } from "@/lib/utils/cn";

/**
 * The one widget renderer (PRD #4 §17, §18).
 *
 * A widget is a configuration entry plus a payload; there is no bespoke
 * component per role or per module. A widget that failed to load says so and
 * leaves the rest of the dashboard working (PRD #4 §76, §77).
 */
const SPAN: Record<string, 1 | 2 | 3> = {
  SMALL: 1,
  MEDIUM: 1,
  LARGE: 2,
  FULL: 3,
};

const ALERT_STYLES: Record<AlertPriority, string> = {
  CRITICAL: "border-l-danger bg-danger-soft/40",
  WARNING: "border-l-warning bg-warning-soft/40",
  INFO: "border-l-info bg-info-soft/40",
};

export function DashboardWidget({ widget }: { widget: ResolvedWidget }) {
  const { definition, payload } = widget;

  const isEmpty =
    payload.kind !== "error" && "items" in payload && payload.items.length === 0;

  return (
    <section
      className={cn(
        // min-w-0: a grid item defaults to min-width:auto and will not shrink
        // below its content, which is how a single long line inside a widget
        // pushes the whole page sideways on a phone (PRD #7 §85).
        "nesto-card flex min-w-0 flex-col p-5",
        widgetSpanClasses[SPAN[definition.size]],
      )}
      aria-labelledby={`widget-${definition.key}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`widget-${definition.key}`} className="text-card font-semibold text-fg">
            {definition.title}
          </h2>
          {definition.description ? (
            <p className="mt-0.5 text-meta text-fg-subtle">{definition.description}</p>
          ) : null}
        </div>

        {definition.href && !isEmpty ? (
          <Link
            href={definition.href}
            className="inline-flex shrink-0 items-center gap-1 text-table font-medium text-accent-strong transition-opacity hover:opacity-80"
          >
            View all
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>

      <div className="mt-4 min-w-0 flex-1">
        {payload.kind === "error" ? (
          <p className="text-table text-fg-muted">
            Unable to load this section. Refresh the page to try again.
          </p>
        ) : isEmpty ? (
          <p className="text-table text-fg-subtle">{definition.emptyMessage}</p>
        ) : (
          <WidgetBody payload={payload} />
        )}
      </div>
    </section>
  );
}

function WidgetBody({ payload }: { payload: ResolvedWidget["payload"] }) {
  switch (payload.kind) {
    case "list":
      return (
        <ul className="divide-y divide-line">
          {payload.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <p className="truncate text-table font-medium text-fg">{item.title}</p>
                )}
                {item.subtitle ? (
                  <p className="truncate text-meta text-fg-subtle">{item.subtitle}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.meta ? (
                  <span className="text-meta tabular-nums text-fg-muted">{item.meta}</span>
                ) : null}
                {item.status ? <StatusBadge status={item.status} /> : null}
              </div>
            </li>
          ))}
        </ul>
      );

    case "breakdown":
    case "progress": {
      const max = Math.max(...payload.items.map((item) => item.value), 1);
      return (
        <ul className="space-y-2.5">
          {payload.items.map((item) => (
            <li key={item.label}>
              <div className="flex items-baseline justify-between gap-3">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="truncate text-table text-fg-muted transition-colors hover:text-accent"
                  >
                    {item.status ? <StatusBadge status={item.status} /> : item.label}
                  </Link>
                ) : (
                  <span className="truncate text-table text-fg-muted">
                    {item.status ? <StatusBadge status={item.status} /> : item.label}
                  </span>
                )}
                <span className="shrink-0 text-table font-medium tabular-nums text-fg">
                  {item.display ?? item.value}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hover">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round((item.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      );
    }

    case "alerts":
      return (
        <ul className="space-y-2">
          {payload.items.map((item) => {
            const content = (
              <div
                className={cn(
                  "flex min-w-0 items-start gap-3 rounded-md border-l-2 px-3 py-2.5",
                  ALERT_STYLES[item.priority],
                )}
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <div className="min-w-0">
                  <p className="text-table font-medium text-fg">{item.title}</p>
                  <p className="text-meta text-fg-muted">{item.detail}</p>
                </div>
              </div>
            );

            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="block transition-opacity hover:opacity-85">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      );

    case "approvals":
      return (
        <ul className="divide-y divide-line">
          {payload.items.map((item) => (
            <li key={item.id} className="py-2.5 first:pt-0">
              <Link href={item.href} className="group block">
                <p className="truncate text-table font-medium text-fg transition-colors group-hover:text-accent">
                  {item.title}
                </p>
                <p className="truncate text-meta text-fg-subtle">{item.subtitle}</p>
              </Link>
            </li>
          ))}
        </ul>
      );

    case "activity":
      return (
        <ul className="space-y-3">
          {payload.items.map((item) => (
            <li key={item.id} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong"
              />
              <div className="min-w-0">
                <p className="text-table text-fg">
                  <span className="font-medium">{item.actor}</span> {item.message}
                </p>
                <p className="text-meta text-fg-subtle">{item.createdAt}</p>
              </div>
            </li>
          ))}
        </ul>
      );

    default:
      return null;
  }
}
