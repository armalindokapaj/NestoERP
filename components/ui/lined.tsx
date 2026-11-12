import type * as React from "react";

import Link from "@/components/navigation/nav-link";
import { cn } from "@/lib/utils/cn";

/**
 * The phone's lined pieces (docs/ui/UI-04-navigation-layouts.md §Phone), the
 * site's drawing set brought into the platform: lists that share their lines,
 * a caption over each like the site's section bar, figures in cells.
 * Square, no shadows; the page's own colour under them.
 */

/** A list's caption: the number in grey, the name in mono capitals, a count on the right; ruled above and below. */
export function LineCaption({ number, label, count, id, className }: { number: string; label: string; count?: React.ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={cn("flex h-11 items-center justify-between gap-4 border-y border-line-strong px-4 font-mono text-meta font-medium uppercase tracking-[0.12em] sm:px-6", className)}>
      <span className="min-w-0 truncate text-fg">
        <span aria-hidden="true" className="mr-2.5 text-fg-subtle">
          {number} /
        </span>
        {label}
      </span>
      {count !== undefined && count !== null ? <span className="shrink-0 text-fg-subtle">{count}</span> : null}
    </h2>
  );
}

/** A row of a lined list: the whole row is the target, at least 68px tall for a gloved thumb. */
export const lineRow =
  "flex min-h-[4.25rem] w-full items-center gap-3.5 border-b border-line px-4 py-3 text-left transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6";

/** The square that holds a row's icon. */
export function LineIcon({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "gold" }) {
  return (
    <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center border [&_svg]:size-[18px]", tone === "gold" ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong text-fg")}>
      {children}
    </span>
  );
}

export type LineFigure = { label: string; value: number; href: string; tone?: "plain" | "danger" };

/** Figures in cells that share their lines; each opens its list. */
export function LineFigures({ figures, label }: { figures: LineFigure[]; label: string }) {
  return (
    <ul aria-label={label} className="grid border-y border-line-strong" style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}>
      {figures.map((figure) => (
        <li key={figure.label} className="min-w-0 border-l border-line-strong first:border-l-0">
          <Link href={figure.href} className="flex min-h-24 flex-col justify-between gap-2.5 px-3 py-3.5 transition-colors hover:bg-hover sm:px-6">
            <span className={cn("font-display text-[2.75rem] font-medium leading-none tabular-nums", figure.tone === "danger" && figure.value > 0 ? "text-danger-strong" : "text-fg")}>{figure.value}</span>
            <span className="truncate font-mono text-meta font-medium uppercase tracking-[0.1em] text-fg-subtle">{figure.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A page's head on the lined pages: a mono key, then a statement in the
 * display face with its gold square. The statement is not the page's name —
 * the top bar takes that from the document's title — so it carries no
 * `data-page-title`.
 */
export function LineHead({ eyebrow, title, children, action }: { eyebrow: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 px-4 pb-6 pt-2 sm:px-6">
      <p className="font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg-subtle">{eyebrow}</p>
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-display text-[2.5rem] font-medium leading-[0.96] tracking-[-0.02em] text-fg">
          {title}
          <span aria-hidden="true" className="ml-[0.04em] inline-block size-[0.16em] bg-accent" />
        </h1>
        {action}
      </div>
      {children}
    </header>
  );
}
