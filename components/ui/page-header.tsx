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
 * a record's sub-page, a settings page. The kind picks version 1's drawing and
 * is published as `data-page-header`.
 */
export type PageHeaderKind = "page" | "module" | "record" | "context" | "settings";

type HeaderDrawing = { root: string; row: string; text: string; title: string; subtitle: string; status: string; meta: string };

/**
 * Version 1, class for class as the four components drew it before they shared
 * this file: the serif display title of a plain page, the sans title of a
 * module and a record, the one-line header of a record's sub-page, and the
 * settings heading that left room for a breadcrumb it no longer draws. Nothing
 * here may change what version 1 renders (UI-02 §33).
 */
const V1: Record<PageHeaderKind, HeaderDrawing> = {
  page: {
    root: "",
    row: "flex flex-wrap items-start justify-between gap-3",
    text: "min-w-0",
    title: "font-serif font-normal text-page text-fg md:text-display [overflow-wrap:anywhere]",
    subtitle: "mt-1.5 text-body text-fg-muted",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: "mt-4 flex flex-wrap gap-x-8 gap-y-2",
  },
  module: {
    root: "",
    row: "flex flex-wrap items-start justify-between gap-3",
    text: "min-w-0",
    title: "text-page font-semibold text-fg [overflow-wrap:anywhere]",
    subtitle: "mt-1.5 text-body text-fg-muted",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: "mt-4 flex flex-wrap gap-x-8 gap-y-2",
  },
  record: {
    root: "space-y-4",
    row: "flex flex-wrap items-start justify-between gap-4",
    text: "min-w-0",
    title: "text-page font-semibold text-fg [overflow-wrap:anywhere]",
    subtitle: "mt-1 text-table text-fg-subtle [overflow-wrap:anywhere]",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: "mt-4 flex flex-wrap gap-x-8 gap-y-2",
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
    title: "mt-2 text-page font-semibold text-fg",
    subtitle: "mt-1.5 text-body text-fg-muted",
    status: "mt-2.5 flex flex-wrap items-center gap-2",
    meta: "mt-4 flex flex-wrap gap-x-8 gap-y-2",
  },
};

/**
 * Version 2 (UI-02 §7.2, §18.1): one header, whatever the page. The title is
 * the 28/36 page title at weight 600 (24/32 on a phone, §6.2), the line under
 * it is body text in the secondary colour 4px below, status follows 8px below
 * and the key facts 12px below that; the actions sit at the title's level and
 * go under it when the two no longer fit side by side. A long name breaks
 * anywhere rather than pushing the actions off the page (§24).
 */
const V2_FULL: HeaderDrawing = {
  root: "",
  row: "ds2:flex ds2:flex-wrap ds2:items-start ds2:justify-between ds2:gap-x-4 ds2:gap-y-3",
  text: "ds2:min-w-0",
  title: "ds2:mt-0 ds2:text-page ds2:font-semibold ds2:[overflow-wrap:anywhere]",
  subtitle: "ds2:mt-1 ds2:text-body ds2:text-fg-muted ds2:[overflow-wrap:anywhere]",
  status: "ds2:mt-2",
  meta: "ds2:mt-3 ds2:gap-x-6",
};

/** Version 2 inside a record (§18.1): the record's name on one compact line, at the section-heading step. */
const V2_COMPACT: HeaderDrawing = {
  root: "",
  row: "ds2:gap-x-4",
  text: "",
  title: "",
  subtitle: "ds2:text-body ds2:text-fg-muted",
  status: "",
  meta: "",
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
  /** The header will hold Help below lg (a module page): its ⋯ is drawn from the first paint (`PageMenuSlot`). */
  reserveMenu?: boolean;
  className?: string;
  /** Extra classes for the block holding the title, its line, status and facts (a record named above it below lg). */
  textClassName?: string;
}) {
  const v1 = V1[kind];
  const v2 = kind === "context" ? V2_COMPACT : V2_FULL;
  // A record's sub-page keeps everything on the title's line, so the line under the title is inline there.
  const Subtitle = kind === "context" ? "span" : "p";
  return (
    <div data-page-header={kind} className={cn(v1.root, v2.root, className)}>
      {lead}
      <div data-page-header-row className={cn(v1.row, v2.row, PAGE_MENU_ROW)}>
        <div className={cn(v1.text, v2.text, PAGE_MENU_TEXT, textClassName)}>
          <h1 data-page-title className={cn(v1.title, v2.title)}>{title}</h1>
          {subtitle === null || subtitle === undefined ? null : <Subtitle className={cn(v1.subtitle, v2.subtitle)}>{subtitle}</Subtitle>}
          {status ? <div className={cn(v1.status, v2.status)}>{status}</div> : null}
          {meta && meta.length > 0 ? (
            <dl className={cn(v1.meta, v2.meta)}>
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
        {/* Below lg: the ⋯ for the page's tips and Help, where no record menu holds them (components/navigation/page-menu.tsx). */}
        <PageMenuSlot reserve={reserveMenu} />
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
 * right. From lg nothing here applies: the actions and the ⋯ are drawn as ever.
 */
const PAGE_MENU_ROW = "group/page-header-row max-lg:has-[[data-page-menu]]:justify-start max-lg:[&_[data-page-menu]]:order-1";
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
