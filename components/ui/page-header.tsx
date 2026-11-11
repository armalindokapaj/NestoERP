import * as React from "react";

import { PageMenuSlot } from "@/components/navigation/page-menu";
import { cn } from "@/lib/utils/cn";

/**
 * Page and section headers (design spec §7, §59).
 * One heading per level, so nothing on the page competes with the title.
 *
 * The action group keeps its width while it fits and wraps inside the page
 * when it does not: `max-w-full` caps a group that is wider than the screen, so
 * three or four buttons at 320px go onto a second row rather than scrolling the
 * page sideways. Every action stays on screen (AUD-04 §3, SP-13, MW-01).
 */
export const headerActionsClass = "flex max-w-full shrink-0 flex-wrap items-center gap-2";

/**
 * Which page the header belongs to: a plain page, a module landing, a record,
 * a record's sub-page, a settings page. The kind picks the drawing and is
 * published as `data-page-header`.
 */
export type PageHeaderKind = "page" | "module" | "record" | "context" | "settings";

/**
 * The facts, as the reference's figures: each fact under its own hairline,
 * side by side as the width allows, the name in mono capitals over the value in
 * the display face (`dt` is already `nesto-eyebrow`).
 */
const FACTS =
  "mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-x-6 gap-y-4 " +
  "[&>div]:border-t [&>div]:border-line [&>div]:pt-2.5 " +
  "[&_dd]:mt-1.5 [&_dd]:font-display [&_dd]:text-[1.625rem] [&_dd]:leading-none";

type HeaderDrawing = { root: string; row: string; text: string; title: string; subtitle: string; status: string; meta: string };

/**
 * The drawing of each kind: a plain page, a module, a record, a record's
 * sub-page and the settings heading (docs/ui/UI-03-nesto-theme.md §5): every
 * title in the display face, and the line under a page's or a module's title
 * as an italic standfirst. A page's or a module's title is 48px from md and
 * ends in the homepage's gold square (styles/globals.css, `data-page-title`).
 */
const DRAWING: Record<PageHeaderKind, HeaderDrawing> = {
  page: {
    root: "nesto-rule pb-5",
    row: "flex flex-wrap items-start justify-between gap-3",
    text: "min-w-0 flex-1 max-md:basis-full",
    title: "text-page text-fg md:text-[3rem] md:leading-none md:tracking-(--nesto-tracking-display) [overflow-wrap:anywhere] font-display",
    subtitle: "mt-1.5 text-fg-muted nesto-standfirst text-card",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: FACTS,
  },
  module: {
    root: "nesto-rule pb-5",
    row: "flex flex-wrap items-start justify-between gap-3",
    text: "min-w-0 flex-1 max-md:basis-full",
    title: "text-page text-fg [overflow-wrap:anywhere] font-display md:text-[3rem] md:leading-none md:tracking-(--nesto-tracking-display)",
    subtitle: "mt-1.5 text-fg-muted nesto-standfirst text-card",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: FACTS,
  },
  record: {
    root: "space-y-4",
    row: "flex flex-wrap items-start justify-between gap-4",
    text: "min-w-0 flex-1 max-md:basis-full",
    title: "text-page text-fg [overflow-wrap:anywhere] font-display",
    subtitle: "mt-1 text-table text-fg-subtle [overflow-wrap:anywhere]",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: FACTS,
  },
  context: {
    root: "space-y-3",
    row: "flex flex-wrap items-center justify-between gap-3",
    text: "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1",
    title: "min-w-0 text-section font-semibold text-fg [overflow-wrap:anywhere]",
    subtitle: "min-w-0 text-table text-fg-subtle [overflow-wrap:anywhere]",
    // The badge sits in the title's own line: its wrapper draws no box.
    status: "contents",
    meta: "flex flex-wrap gap-x-8 gap-y-2",
  },
  settings: {
    root: "",
    row: "",
    text: "",
    title: "mt-2 text-page text-fg font-display",
    subtitle: "mt-1.5 text-body text-fg-muted",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: FACTS,
  },
};

/**
 * The one header block under every page (UI-02 §7.2): `PageHeader` here,
 * `ModulePage`, `RecordHeader`, `RecordContextHeader` and `SettingsPageHeader`
 * in components/modules all draw this, so a page title, the line under it, its
 * status, its facts and its actions are one piece of markup:
 *
 *   [data-page-header] > row > (text: h1[data-page-title], subtitle, status, meta) + actions
 *
 * `lead` is what a header mounts before its row and draws nothing for: the
 * breadcrumb trail a record hands to the shell's bar.
 */
export function PageHeaderFrame({
  kind,
  lead,
  title,
  subtitle,
  status,
  meta,
  actions,
  reserveMenu = false,
  className,
  textClassName,
}: {
  kind: PageHeaderKind;
  lead?: React.ReactNode;
  title: React.ReactNode;
  /** The line under the title; `null` or absent draws none. */
  subtitle?: React.ReactNode;
  /** Status and other badges, already drawn. */
  status?: React.ReactNode;
  /** Short key/value pairs shown under the title. */
  meta?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  /** The header will hold Help (a module page): its ⋯ is drawn from the first paint (`PageMenuSlot`). */
  reserveMenu?: boolean;
  className?: string;
  /** Extra classes for the block holding the title, its line, status and facts (a record named above it below lg). */
  textClassName?: string;
}) {
  const d = DRAWING[kind];
  // A record's sub-page keeps everything on the title's line, so the line under the title is inline there.
  const Subtitle = kind === "context" ? "span" : "p";
  /*
   * From lg the page's ⋯ (its tips and Help, where no record menu holds them)
   * follows the status, or the title where there is no status: in a line of
   * text it takes no more height than the text (`-my-…`). Below lg it is the
   * row's own slot at the end of the title row, after the actions.
   */
  const inline = kind === "context" || Boolean(status);
  const wideMenu = <PageMenuSlot at="lg" reserve={reserveMenu} className={inline ? "-my-1.5 touch:-my-3" : undefined} />;
  const heading = <h1 data-page-title className={cn(d.title, !inline && "lg:min-w-0")}>{title}</h1>;
  return (
    <div data-page-header={kind} className={cn(d.root, className)}>
      {lead}
      <div data-page-header-row className={cn(d.row, PAGE_MENU_ROW)}>
        <div className={cn(d.text, "animate-[nesto-rise-focus_0.8s_cubic-bezier(0.25,0.46,0.45,0.94)_both] motion-reduce:animate-none", PAGE_MENU_TEXT, textClassName)}>
          {inline ? (
            heading
          ) : (
            // The title's line from lg; below lg this box draws nothing of its own.
            <div className="contents lg:flex lg:items-start lg:gap-2">
              {heading}
              {wideMenu}
            </div>
          )}
          {subtitle === null || subtitle === undefined ? null : <Subtitle className={d.subtitle}>{subtitle}</Subtitle>}
          {status ? (
            <div className={d.status}>
              {status}
              {kind === "context" ? null : wideMenu}
            </div>
          ) : null}
          {/* A record's sub-page: one line, title, its line and status, then the ⋯. */}
          {kind === "context" ? wideMenu : null}
          {meta && meta.length > 0 ? (
            <dl className={d.meta}>
              {meta.map((entry) => (
                <div key={entry.label} className="min-w-0">
                  <dt className="nesto-eyebrow text-fg-subtle">{entry.label}</dt>
                  <dd className="mt-0.5 text-table text-fg [overflow-wrap:anywhere]">{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {actions ? <div data-page-actions className={cn(headerActionsClass, PAGE_MENU_ACTIONS)}>{actions}</div> : null}
        {/* Below lg: the ⋯ for the page's tips, Help and secondary actions, where no record menu holds them (components/navigation/page-menu.tsx). */}
        <PageMenuSlot at="belowLg" reserve={reserveMenu} />
      </div>
    </div>
  );
}

/*
 * The page's ⋯ at the end of the title row, below lg (the user's rule: "the ⋯
 * always goes at the end of the page's title or status row"). A ⋯ marks
 * itself `data-page-menu` — the header's own slot, or a record's menu among
 * the actions (TaskActions, ClientActions, EntityActionSheet …). While the row
 * holds one, the action group lets go of its box (`contents`) so each action
 * is an item of the row; the title block takes the line but for the ⋯'s room,
 * the ⋯ follows it, and the other actions wrap onto the next line, left to
 * right. From lg none of this applies: the actions are drawn as ever, a
 * record's ⋯ among them, and the header's own ⋯ follows the title or status
 * (`wideMenu` above).
 */
// `flex flex-wrap`: a settings header's row is a plain block, which would put its ⋯ on a line of its own.
const PAGE_MENU_ROW = "group/page-header-row max-lg:has-[[data-page-menu]]:flex max-lg:has-[[data-page-menu]]:flex-wrap max-lg:has-[[data-page-menu]]:justify-start max-lg:[&_[data-page-menu]]:order-1";
const PAGE_MENU_TEXT = "max-lg:group-has-[[data-page-menu]]/page-header-row:min-w-0 max-lg:group-has-[[data-page-menu]]/page-header-row:flex-[1_1_calc(100%_-_4.5rem)]";
const PAGE_MENU_ACTIONS = "max-lg:group-has-[[data-page-menu]]/page-header-row:contents max-lg:group-has-[[data-page-menu]]/page-header-row:[&>:not([data-page-menu])]:order-3";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return <PageHeaderFrame kind="page" title={title} subtitle={description || undefined} actions={actions} className={className} />;
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-card font-semibold text-fg [overflow-wrap:anywhere]">{title}</h2>
        {description ? <p className="mt-0.5 text-table text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className={headerActionsClass}>{actions}</div> : null}
    </div>
  );
}
