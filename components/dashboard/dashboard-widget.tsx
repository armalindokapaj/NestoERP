import Link from "@/components/navigation/nav-link";
import { ArrowRight, Building2, ChevronRight, CircleAlert, Info, MapPin, TriangleAlert } from "lucide-react";

import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { widgetSpanClasses } from "@/components/dashboard/dashboard-grid";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import type { AlertPriority, ResolvedWidget } from "@/lib/modules/dashboard/dashboard.types";
import { cn } from "@/lib/utils/cn";
import { getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";
import { widgetText } from "./config-text";

/**
 * The one widget renderer (PRD #4 §17, §18).
 *
 * A widget is a configuration entry plus a payload; there is no bespoke
 * component per role or per module. A widget that failed to load says so and
 * leaves the rest of the dashboard working (PRD #4 §76, §77).
 */
export const SPAN: Record<string, 1 | 2 | 3> = {
  SMALL: 1,
  MEDIUM: 1,
  LARGE: 2,
  FULL: 3,
};

/** Tone by priority: a round icon, and the colour the figure takes (Premium Mobile §5.4). */
const ALERT_TONE: Record<AlertPriority, { icon: typeof Info; circle: string; figure: string }> = {
  CRITICAL: { icon: TriangleAlert, circle: "bg-danger-soft text-danger-strong", figure: "text-danger-strong" },
  WARNING: { icon: CircleAlert, circle: "bg-warning-soft text-warning-strong", figure: "text-warning-strong" },
  INFO: { icon: Info, circle: "bg-info-soft text-info-strong", figure: "text-info-strong" },
};

/** A title that opens with a figure ("€4,200 overdue") shows the figure large; the string is unchanged. */
function splitFigure(title: string): { figure: string; rest: string } | null {
  const match = /^([€$£]?[\d.,]+)\s+(.+)$/.exec(title);
  return match ? { figure: match[1], rest: match[2] } : null;
}

/**
 * A link that, on a group widget, enters the company the row is about before it
 * goes on (Workspace Context §74); an ordinary link everywhere else.
 */
function RowLink({ href, companyId, className, children }: { href: string; companyId?: string; className?: string; children: React.ReactNode }) {
  if (companyId) {
    return (
      <CompanyRecordLink companyId={companyId} href={href} className={className}>
        {children}
      </CompanyRecordLink>
    );
  }
  return (
    <Link navSource="dashboard" href={href} className={className}>
      {children}
    </Link>
  );
}

/** `fill`: rendered inside a cell that already carries the span (NAV-03 streamed dashboard). */
export async function DashboardWidget({ widget, fill = false }: { widget: ResolvedWidget; fill?: boolean }) {
  const t = await getTranslations("dashboard");
  const { definition, payload } = widget;

  const isEmpty =
    payload.kind !== "error" && "items" in payload && payload.items.length === 0;
  // A source that could not be read: said above the rows, and never shown as "nothing here" (AUD-10 §4, CW-03).
  const incomplete = "incomplete" in payload ? payload.incomplete : undefined;

  return (
    <section
      className={cn(
        // min-w-0: a grid item defaults to min-width:auto and will not shrink
        // below its content, which is how a single long line inside a widget
        // pushes the whole page sideways on a phone (PRD #7 §85).
        "nesto-card flex min-w-0 flex-col p-5",
        fill ? "flex-1" : widgetSpanClasses[SPAN[definition.size]],
      )}
      aria-labelledby={`widget-${definition.key}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id={`widget-${definition.key}`} className="text-card font-semibold text-fg">
              {widgetText(t, definition.key, "title", definition.title)}
            </h2>
            {payload.kind === "alerts" && payload.items.length > 0 ? (
              <span className="grid h-[26px] min-w-[26px] place-items-center rounded-full bg-accent-soft px-1.5 text-meta font-bold text-accent-strong" data-testid="alerts-count">
                {payload.items.length}
              </span>
            ) : null}
          </div>
          {definition.description ? (
            <p className="mt-0.5 text-meta text-fg-subtle">{widgetText(t, definition.key, "description", definition.description)}</p>
          ) : null}
        </div>

        {definition.href && !isEmpty ? (
          <Link navSource="dashboard"
            href={definition.href}
            className="inline-flex shrink-0 items-center gap-1 text-table font-medium text-accent-strong transition-opacity hover:opacity-80"
          >
            {t("viewAll")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>

      <div className="mt-4 min-w-0 flex-1">
        {payload.kind === "error" ? (
          <p className="text-table text-fg-muted">
            {t("loadFailed")}
          </p>
        ) : (
          <>
            {incomplete ? (
              <p role="status" className="mb-3 flex items-start gap-2 text-meta text-warning-strong" data-testid="widget-incomplete">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{incomplete}</span>
              </p>
            ) : null}
            {isEmpty ? (incomplete ? null : <p className="text-table text-fg-subtle">{widgetText(t, definition.key, "emptyMessage", definition.emptyMessage)}</p>) : <WidgetBody payload={payload} t={t} />}
          </>
        )}
      </div>
    </section>
  );
}

function WidgetBody({ payload, t }: { payload: ResolvedWidget["payload"]; t: Translate<"dashboard"> }) {
  switch (payload.kind) {
    case "list":
      return (
        <ul className="divide-y divide-line">
          {payload.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                {item.person ? (
                  <PersonLink {...item.person} name={item.title} detail={item.subtitle} className="block truncate text-table" />
                ) : item.href ? (
                  <RowLink
                    href={item.href}
                    companyId={item.companyId}
                    className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                  >
                    {item.title}
                  </RowLink>
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
                  <RowLink
                    href={item.href}
                    companyId={item.companyId}
                    className="truncate text-table text-fg-muted transition-colors hover:text-accent"
                  >
                    {item.status ? <StatusBadge status={item.status} /> : item.label}
                  </RowLink>
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
        <ul className="divide-y divide-line">
          {payload.items.map((item) => {
            const tone = ALERT_TONE[item.priority];
            const ToneIcon = tone.icon;
            const split = splitFigure(item.title);
            const content = (
              <div className="flex min-w-0 items-center gap-3.5 py-3.5">
                <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-full", tone.circle)}>
                  <ToneIcon className="size-[18px]" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  {/* On the group's list every alert names its company (Workspace Context §45, §71). */}
                  {item.company ? <p className="text-micro font-medium text-fg-subtle" data-testid="alert-company">{item.company}</p> : null}
                  <p className="text-body font-semibold text-fg">
                    {split ? (
                      <>
                        <span className={cn("font-serif text-[1.625rem] font-normal leading-none", tone.figure)}>{split.figure}</span> {split.rest}
                      </>
                    ) : (
                      item.title
                    )}
                  </p>
                  <p className="text-meta text-fg-muted">{item.detail}</p>
                </div>
                {item.href ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" /> : null}
              </div>
            );

            return (
              <li key={item.id} className="first:[&>*]:pt-0 last:[&>*]:pb-0">
                {item.href ? (
                  <RowLink href={item.href} companyId={item.companyId} className="block transition-colors hover:bg-row-hover active:bg-accent-soft">
                    {content}
                  </RowLink>
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
              <Link navSource="dashboard" href={item.href} className="group block">
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
                className="mt-1.5 size-1.5 shrink-0 rounded-full border border-accent bg-transparent"
              />
              <div className="min-w-0">
                <p className="text-table text-fg">
                  {item.actorMemberId ? <PersonLink memberId={item.actorMemberId} name={item.actor} /> : <span className="font-medium">{item.actor}</span>} {item.message}
                </p>
                <p className="text-meta text-fg-subtle">{item.context ? `${item.createdAt} · ${item.context}` : item.createdAt}</p>
              </div>
            </li>
          ))}
        </ul>
      );

    case "projects":
      return (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {payload.items.map((project) => (
            <li key={project.id} className="min-w-0">
              <Link navSource="dashboard" href={project.href} className="group block overflow-hidden rounded-lg border border-line transition-colors hover:border-line-strong" data-testid="key-project">
                <div className="relative aspect-[4/3] bg-hover">
                  {project.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- an authorised thumbnail route, not a static asset
                    <img src={project.coverUrl} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid size-full place-items-center text-fg-subtle">
                      <Building2 aria-hidden="true" className="size-8" />
                    </div>
                  )}
                  <span className="absolute left-2 top-2">
                    <StatusBadge status={project.status} />
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-table font-semibold text-fg transition-colors group-hover:text-accent">{project.name}</p>
                    <p className="truncate text-meta text-fg-subtle">{project.company}</p>
                  </div>
                  {project.location ? (
                    <p className="flex min-w-0 items-center gap-1 text-meta text-fg-muted">
                      <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="truncate">{project.location}</span>
                    </p>
                  ) : null}
                  {project.tags.length ? (
                    <ul className="flex flex-wrap gap-1" aria-label={t("type")}>
                      {project.tags.map((tag) => (
                        <li key={tag} className="rounded-full bg-hover px-2 py-0.5 text-meta text-fg-muted">
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {project.progress !== null ? (
                    <div>
                      <div className="flex items-baseline justify-between text-meta">
                        <span className="text-fg-muted">{t("progress")}</span>
                        <span className="font-medium tabular-nums text-fg">{project.progress}%</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label={t("progressOf", { name: project.name })} aria-valuenow={project.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-accent" style={{ width: `${project.progress}%` }} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      );

    default:
      return null;
  }
}
