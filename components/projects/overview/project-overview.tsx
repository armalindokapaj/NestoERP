/* eslint-disable @next/next/no-img-element */
import type * as React from "react";

import {
  ArrowUpRight,
  Box,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  FileWarning,
  Film,
  Image as ImageIcon,
  Play,
  type IconComponent,
} from "@/components/icons";
import Link from "@/components/navigation/nav-link";
import { LineCaption, LineIcon, lineRow } from "@/components/ui/lined";
import { dateText } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import type { ProjectUpcomingItem, ProjectWorkItem } from "@/lib/modules/projects/project-workspace.service";
import { cn } from "@/lib/utils/cn";

/**
 * The project's Overview, drawn (docs/ui/UI-07-unified-design.md §6): the
 * drawing set of My Day brought to a project. Every piece here only draws what
 * the page has read (`app/(nesto)/projects/[projectId]/page.tsx`), so each can
 * stream in its own place and be shown with sample data.
 *
 *   PRJ-014 · ALBA CONSTRUCTION · ACTIVE ⋯                ┌ cover ┐
 *   Society Towers.                                        │       │
 *   Tirana, Albania · Residential · 12,400 m²             └───────┘
 *   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 62%                                 3D ↗ · Renders · Animations
 *   ─────────────────────────────────────────────── ink rule
 *   PROGRESS 62% │ OPEN TASKS 17 │ OVERDUE 3 │ UNITS 128         (figures, each opens its list)
 *   01 / MY WORK      ...              04 / DETAILS
 *   02 / UPCOMING     ...              (manager, dates, place, type, area…)
 *   03 / RECENT ACTIVITY
 *   05 / VISUAL LIBRARY
 */

/** A figure in the project's strip: a value that opens the list behind it. */
export type ProjectFigure = {
  key: string;
  label: string;
  value: string;
  href?: string;
  tone?: "plain" | "danger";
  className?: string;
  /** A share, 0–100, drawn as a thin gold rule along the cell's foot (the plan's progress). */
  meter?: number;
};

/** Figures in cells that share their lines, as My Day's. */
export function ProjectFigures({ figures, label, className }: { figures: ProjectFigure[]; label: string; className?: string }) {
  if (!figures.length) return null;
  return (
    <dl aria-label={label} data-testid="project-metrics" className={cn("flex divide-x divide-line-strong border-y border-line-strong", className)}>
      {figures.map((figure) => {
        // The label over the figure; figures stand on one baseline however their labels wrap.
        const body = (
          <>
            <dt className="font-mono text-meta font-medium uppercase leading-tight tracking-[0.1em] text-fg-subtle max-sm:tracking-[0.04em]">{figure.label}</dt>
            <dd className={cn("font-display text-[2.5rem] font-medium leading-none tabular-nums max-sm:text-[2rem]", figure.tone === "danger" ? "text-danger-strong" : "text-fg")}>{figure.value}</dd>
          </>
        );
        const cell = "flex h-full min-h-24 flex-col justify-between gap-2.5 px-3 py-3.5 sm:px-5 max-sm:min-h-20";
        return (
          <div key={figure.key} className={cn("relative min-w-0 flex-1 basis-0", figure.className)}>
            {figure.meter !== undefined ? (
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-line">
                <span className="block h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, figure.meter))}%` }} />
              </span>
            ) : null}
            {figure.href ? (
              <Link href={figure.href} className={cn(cell, "transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}>
                {body}
              </Link>
            ) : (
              <div className={cell}>{body}</div>
            )}
          </div>
        );
      })}
    </dl>
  );
}

export type ProjectQuickAction = {
  key: "task" | "document" | "siteDiary" | "meeting";
  href: string;
};
const ACTION_ICONS: Record<ProjectQuickAction["key"], IconComponent> = {
  task: CheckSquare,
  document: FilePlus2,
  siteDiary: ClipboardList,
  meeting: CalendarPlus,
};
const ACTION_LABELS = {
  task: "newTask",
  document: "addDocument",
  siteDiary: "siteDiary",
  meeting: "newMeeting",
} as const;

/** Below lg: what a person makes on site, in one lined row of square cells — the project already chosen. */
export async function ProjectQuickActions({ actions }: { actions: ProjectQuickAction[] }) {
  if (!actions.length) return null;
  const t = await getTranslations("projects");
  return (
    <nav aria-label={t("mobile.quickActions")} className="lg:hidden">
      <ul
        data-testid="project-quick-actions"
        className="grid border-b border-line-strong"
        style={{
          gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))`,
        }}
      >
        {actions.map((action) => {
          const Icon = ACTION_ICONS[action.key];
          return (
            <li key={action.key} className="min-w-0 border-l border-line first:border-l-0">
              <Link
                href={action.href}
                className="flex min-h-16 flex-col items-center justify-center gap-1.5 px-1 text-center text-meta font-medium text-fg transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Icon aria-hidden="true" className="size-5 text-fg-subtle" />
                <span className="max-w-full truncate">{t(`mobile.${ACTION_LABELS[action.key]}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const WORK_ICONS = {
  tasks: CheckCircle2,
  approvals: ClipboardCheck,
  meetings: CalendarDays,
  documents: FileWarning,
};

/** 01 / My work: what is yours in this project, each a line that opens its list (the project's overdue tasks are a figure above). */
export async function ProjectMyWork({ number, items }: { number: string; items: ProjectWorkItem[] }) {
  const t = await getTranslations("projects");
  const rows = items.filter((item) => item.count > 0 || item.partial);
  return (
    <section aria-labelledby="project-my-work" data-testid="project-attention">
      <LineCaption id="project-my-work" number={number} label={t("overview.myWork")} />
      {rows.length ? (
        rows.map((item) => {
          const Icon = WORK_ICONS[item.key];
          return (
            <Link key={item.key} href={item.href} className={cn(lineRow, "min-h-14")}>
              <LineIcon>
                <Icon />
              </LineIcon>
              <span className="min-w-0 flex-1 text-table text-fg">{t(`overview.workKind.${item.key}`)}</span>
              <span className="font-display text-[1.375rem] font-medium tabular-nums leading-none text-fg" title={item.partial ? t("overview.approvalsPartial") : undefined}>
                {item.partial ? (item.count ? `${item.count}+` : "—") : item.count}
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
            </Link>
          );
        })
      ) : (
        <p className="border-b border-line px-4 py-4 text-table text-fg-subtle sm:px-6">{t("overview.nothingNeedsYou")}</p>
      )}
    </section>
  );
}

/** 02 / Upcoming: the next dates, a mono day on the left as My Day's times. */
export async function ProjectUpcoming({ number, items }: { number: string; items: ProjectUpcomingItem[] }) {
  const [t, locale] = await Promise.all([getTranslations("projects"), getLocale()]);
  return (
    <section aria-labelledby="project-upcoming">
      <LineCaption id="project-upcoming" number={number} label={t("overview.upcoming")} count={items.length || undefined} />
      {items.length ? (
        items.map((item) => (
          <Link key={item.id} href={item.href} className={cn(lineRow, "min-h-14 items-start")}>
            <span className="w-16 shrink-0 pt-0.5 font-mono text-meta font-medium uppercase tracking-[0.06em] text-fg-subtle">{dateText(new Date(item.at), { day: "2-digit", month: "short" }, locale)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-table font-medium text-fg">{item.title}</span>
              <span className="mt-0.5 block text-meta text-fg-subtle">{t(`overview.upcomingKind.${item.kind}`)}</span>
            </span>
            <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          </Link>
        ))
      ) : (
        <p className="border-b border-line px-4 py-4 text-table text-fg-subtle sm:px-6">{t("overview.noUpcoming")}</p>
      )}
    </section>
  );
}

export type ProjectActivityLine = {
  id: string;
  actor: string;
  text: string;
  at: string;
};

/** 03 / Recent activity: who did what, newest first; View all opens the project's activity. */
export async function ProjectActivity({ number, entries, href }: { number: string; entries: ProjectActivityLine[] | null; href: string }) {
  const [t, locale] = await Promise.all([getTranslations("projects"), getLocale()]);
  return (
    <section aria-labelledby="project-activity">
      <div className="relative">
        <LineCaption id="project-activity" number={number} label={t("overview.recentActivity")} />
        {entries?.length ? (
          <Link href={href} className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-meta font-medium uppercase tracking-[0.1em] text-accent-strong hover:text-fg sm:right-6">
            {t("overview.viewAll")}
          </Link>
        ) : null}
      </div>
      {entries?.length ? (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3.5 border-b border-line px-4 py-3 sm:px-6">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
              <p className="min-w-0 flex-1 text-table text-fg">
                <span className="font-medium">{entry.actor}</span> {entry.text}
              </p>
              <span className="shrink-0 pt-0.5 font-mono text-meta uppercase tracking-[0.06em] text-fg-subtle">{dateText(new Date(entry.at), { day: "2-digit", month: "short" }, locale)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-b border-line px-4 py-4 text-table text-fg-subtle sm:px-6">{t("overview.noActivity")}</p>
      )}
    </section>
  );
}

export type ProjectFact = {
  key: string;
  label: string;
  value: React.ReactNode;
};

/** 04 / Details: the project's facts as lined rows — the label in mono, the value on the right — and its description under them. */
export async function ProjectDetails({ number, facts, description }: { number: string; facts: ProjectFact[]; description: string | null }) {
  const t = await getTranslations("projects");
  return (
    <section aria-labelledby="project-details">
      <LineCaption id="project-details" number={number} label={t("overview.details")} />
      <dl>
        {facts.map((fact) => (
          <div key={fact.key} className="flex min-h-12 items-baseline justify-between gap-4 border-b border-line px-4 py-3 sm:px-6">
            <dt className="shrink-0 font-mono text-meta font-medium uppercase tracking-[0.08em] text-fg-subtle">{fact.label}</dt>
            <dd className="min-w-0 text-right text-table font-medium text-fg [overflow-wrap:anywhere]">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {/* From lg the description is the title's standfirst. */}
      {description ? <p className="nesto-standfirst border-b border-line px-4 py-4 text-body leading-relaxed text-fg-muted line-clamp-6 sm:px-6 lg:hidden">{description}</p> : null}
    </section>
  );
}

export type ProjectVisualsDTO = {
  coverUrl: string | null;
  threeDUrl: string | null;
  renders: number;
  animations: number;
};

/** The project's picture, square in a 1px frame, with the ways into its visuals as lined rows under it. */
export async function ProjectVisuals({ projectId, name, visuals, className }: { projectId: string; name: string; visuals: ProjectVisualsDTO; className?: string }) {
  const t = await getTranslations("projects");
  const links = [
    visuals.threeDUrl
      ? {
          key: "3d",
          href: visuals.threeDUrl,
          icon: Box,
          label: t("overview.viewIn3d"),
          detail: t("overview.publishedExplorer"),
          short: t("overview.viewIn3d"),
          where: null,
          newTab: true,
        }
      : null,
    visuals.renders
      ? {
          key: "renders",
          href: `/projects/${projectId}/media?type=renders`,
          icon: ImageIcon,
          label: t("overview.viewRenders"),
          detail: t("overview.renders", { count: visuals.renders }),
          short: t("media.renders"),
          where: String(visuals.renders),
          newTab: false,
        }
      : null,
    visuals.animations
      ? {
          key: "animations",
          href: `/projects/${projectId}/media?type=animations`,
          icon: Film,
          label: t("overview.viewAnimations"),
          detail: t("overview.animations", { count: visuals.animations }),
          short: t("media.animations"),
          where: String(visuals.animations),
          newTab: false,
        }
      : null,
  ].filter((link) => link !== null);
  if (!visuals.coverUrl && !links.length) return null;
  return (
    <div className={cn("border border-line-strong bg-surface", className)} data-testid="project-visuals">
      {visuals.coverUrl ? (
        <div className="relative aspect-video overflow-hidden bg-surface-muted lg:aspect-auto lg:min-h-44 lg:flex-1">
          <img src={visuals.coverUrl} alt={t("overview.coverAlt", { name })} className="absolute inset-0 size-full object-cover" fetchPriority="high" sizes="(min-width: 1024px) 26rem, 100vw" />
        </div>
      ) : null}
      {/* Below lg each way in is a lined row; from lg they share one row of cells under the picture, so the block is no taller than the title beside it. */}
      <div className="lg:grid lg:auto-cols-fr lg:grid-flow-col lg:divide-x lg:divide-line lg:border-t lg:border-line">
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            target={link.newTab ? "_blank" : undefined}
            rel={link.newTab ? "noopener noreferrer" : undefined}
            data-testid={link.key === "3d" ? "project-mobile-3d" : undefined}
            className={cn(
              "group/visual flex min-h-12 min-w-0 items-center gap-3 border-t border-line px-4 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              "lg:grid lg:min-h-0 lg:grid-cols-[auto_minmax(0,1fr)] lg:content-center lg:gap-x-2.5 lg:gap-y-0.5 lg:border-t-0 lg:px-3.5 lg:py-3",
              link.key === "3d" && "bg-primary text-primary-fg hover:bg-primary-hover"
            )}
          >
            <link.icon aria-hidden="true" className={cn("size-[18px] shrink-0 lg:row-span-2 lg:self-start", link.key === "3d" ? "text-primary-fg" : "text-fg-subtle")} />
            <span className="min-w-0 flex-1 truncate text-table font-medium lg:hidden">{link.label}</span>
            {/* From lg, in a cell: the short name — View in 3D, 24 renders, 3 animations — over a mono line saying where it goes. */}
            <span className="hidden min-w-0 truncate text-table font-medium lg:block">
              {link.short}
              {link.newTab ? <ArrowUpRight aria-hidden="true" className="ml-1 inline size-3.5 align-[-2px]" /> : null}
            </span>
            {/* On a phone the 3D line keeps its name; its explanation needs the room. */}
            <span className={cn("shrink-0 truncate font-mono text-meta uppercase tracking-[0.06em] lg:text-micro", link.key === "3d" ? "text-primary-fg/70 max-sm:hidden" : "text-fg-subtle")}>{link.where === null ? <span className="lg:hidden">{link.detail}</span> : <><span className="lg:hidden">{link.detail}</span><span className="hidden lg:inline">{link.where}</span></>}</span>
            {link.newTab ? <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 lg:hidden" /> : <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle lg:hidden" />}
          </Link>
        ))}
      </div>
    </div>
  );
}

export type ProjectMediaItem = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds?: number | null;
};

/** 05 / Visual library: four renders in square cells that share their lines, then the animations as lined rows. */
export async function ProjectMediaStrip({ number, projectId, renders, renderCount, animations }: { number: string; projectId: string; renders: ProjectMediaItem[]; renderCount: number; animations: ProjectMediaItem[] }) {
  if (!renders.length && !animations.length) return null;
  const t = await getTranslations("projects");
  return (
    <section aria-labelledby="project-media">
      <div className="relative">
        <LineCaption id="project-media" number={number} label={t("overview.visualLibrary")} count={renderCount + animations.length || undefined} />
      </div>
      {renders.length ? (
        <ul className="grid grid-cols-2 border-b border-line md:grid-cols-4">
          {renders.slice(0, 4).map((item, index) => (
            <li key={item.id} className="border-l border-line first:border-l-0 max-md:[&:nth-child(3)]:border-l-0 max-md:[&:nth-child(n+3)]:border-t">
              <Link
                href={`/projects/${projectId}/media?type=renders`}
                className="group relative block aspect-[4/3] overflow-hidden bg-surface-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt={item.title} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
                ) : null}
                {index === 3 && renderCount > 4 ? <span className="absolute inset-0 grid place-items-center bg-black/55 font-display text-[1.75rem] text-white">+{renderCount - 4}</span> : null}
                <span className="sr-only">{t("overview.open", { title: item.title })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {animations.slice(0, 2).map((item) => (
        <Link key={item.id} href={`/projects/${projectId}/media?type=animations`} className={cn(lineRow, "min-h-16")}>
          <span className="relative grid aspect-video w-24 shrink-0 place-items-center overflow-hidden bg-neutral-900">
            {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-80" /> : null}
            <Play aria-hidden="true" className="relative size-4 fill-current text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-table font-medium text-fg">{item.title}</span>
            <span className="mt-0.5 block font-mono text-meta uppercase tracking-[0.06em] text-fg-subtle">
              {t("overview.animation")}
              {item.durationSeconds ? ` · ${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : ""}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        </Link>
      ))}
      <Link
        href={`/projects/${projectId}/media`}
        className="flex min-h-11 items-center justify-end gap-1.5 border-b border-line px-4 font-mono text-meta font-medium uppercase tracking-[0.1em] text-accent-strong hover:text-fg sm:px-6"
      >
        {t("overview.viewAllMedia")}
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </Link>
    </section>
  );
}

/**
 * From lg, the project's title block: a mono line with its code, company and
 * status and the project's ⋯ right after the status; the name in the display
 * face on its gold square; the facts that place it; the plan's progress as a
 * thin gold rule. The picture stands at its right. Below lg the top bar and
 * the compact header name the project, so this block keeps only its heading,
 * for a screen reader.
 */
export async function ProjectTitleBlock({
  name,
  code,
  company,
  status,
  menu,
  facts,
  description,
  figures,
  aside,
}: {
  name: string;
  code: string;
  company: string;
  status: string;
  menu: React.ReactNode;
  facts: string[];
  /** The project's description, as the title's standfirst. */
  description?: string | null;
  /** The project's figures (`ProjectFigures`), streamed in their own place, standing on the block's foot. */
  figures?: React.ReactNode;
  aside: React.ReactNode;
}) {
  return (
    <header data-section="primary" aria-labelledby="project-title" className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:gap-x-8 lg:border-b lg:border-fg xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <div className="flex min-w-0 flex-col max-lg:contents">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg-subtle max-lg:hidden" data-testid="project-hero-status-line">
          <span>{code}</span>
          <span aria-hidden="true">·</span>
          <span>{company}</span>
          <span aria-hidden="true">·</span>
          <span className="text-fg" data-testid="project-hero-status">
            {status}
          </span>
          <span className="inline-flex items-center normal-case tracking-normal empty:hidden">{menu}</span>
        </div>
        <h1 id="project-title" className="mt-3 font-display text-[3.5rem] font-medium leading-[0.92] tracking-(--nesto-tracking-display) text-fg max-lg:sr-only">
          {name}
          <span aria-hidden="true" className="ml-[0.04em] inline-block size-[0.14em] bg-accent" />
        </h1>
        {description ? <p className="nesto-standfirst mt-3 max-w-3xl text-[1.125rem] leading-snug text-fg-muted line-clamp-2 max-lg:hidden">{description}</p> : null}
        {facts.length ? <p className="mt-3 font-mono text-meta font-medium uppercase tracking-[0.08em] text-fg max-lg:hidden">{facts.join("  ·  ")}</p> : null}
        {/* The figures stand on the block's foot, level with the picture's, so the left half is never empty under the title. */}
        <div className="mt-auto pt-6 empty:hidden max-lg:hidden">{figures}</div>
      </div>
      {/* The picture's column runs to the ink rule, which closes it with the figures. */}
      <div className="max-lg:hidden">{aside}</div>
    </header>
  );
}

