import * as React from "react";
import { ChevronDown } from "@/components/icons";

import { cn } from "@/lib/utils/cn";

/**
 * The rhythm of the public site (design spec §81, §82).
 *
 * Marketing pages are a stack of full-width bands separated by a hairline and
 * alternating between the two neutral grounds. Every band shares one container
 * width and one vertical measure, so the page keeps its cadence no matter how
 * many sections a page turns out to need — and no page has to invent padding.
 */

const tones = {
  canvas: "bg-canvas text-fg",
  surface: "bg-surface text-fg",
  muted: "bg-surface-muted text-fg",
  graphite: "bg-graphite text-graphite-fg",
} as const;

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[1280px] px-[clamp(16px,4vw,48px)]", className)} {...props} />;
}

const grounds = {
  canvas: "[--site-ground:var(--nesto-canvas)]",
  surface: "[--site-ground:var(--nesto-surface)]",
  muted: "[--site-ground:var(--nesto-surface-muted)]",
  graphite: "[--site-ground:var(--nesto-graphite)]",
} as const;

/**
 * A band of the page. With `bar`, it is one of the page's numbered sections:
 * it opens with its bar ("02 / Modules"), which pins under the masthead while
 * the section is on screen, and the index rail lists it (site-index.tsx).
 * Clipped sideways only, never `overflow: hidden`, which would keep the bar
 * from pinning.
 */
export function Section({
  tone = "canvas",
  bordered = true,
  bar,
  index,
  note,
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  tone?: keyof typeof tones;
  bordered?: boolean;
  /** The section's name in its bar and in the index; usually its eyebrow. */
  bar?: string;
  /** A shorter name for the index rail, where the bar's is long. */
  index?: string;
  /** A short line at the bar's other end. */
  note?: string;
  containerClassName?: string;
}) {
  return (
    <section
      {...(bar ? sectionMark(bar, index) : {})}
      className={cn(
        "relative overflow-x-clip",
        tones[tone],
        grounds[tone],
        bordered && "border-b border-line",
        tone === "graphite" && "border-graphite",
        className,
      )}
      {...props}
    >
      {bar ? <SectionBar label={bar} note={note} tone={tone === "graphite" ? "ink" : undefined} /> : null}
      <Container className={cn("py-16 sm:py-20 lg:py-28", containerClassName)}>{children}</Container>
    </section>
  );
}

/** What makes an element one of the page's numbered sections: its name, for the bar's number and the index (or a shorter one for the index). */
export function sectionMark(label: string, index?: string) {
  return { "data-site-section": label, "data-site-index": index } as const;
}

/**
 * A section's bar: its number and name in mono on the left, a short line on
 * the right; below xl, where there is no index rail, how far through the page
 * it is (02 / 05). Goes first inside an element carrying `sectionMark`.
 */
export function SectionBar({ label, note, tone }: { label: string; note?: string; tone?: "ink" }) {
  return (
    <div className="site-bar" data-tone={tone}>
      <Container className="flex h-11 items-center justify-between gap-6">
        <span className="site-bar-n min-w-0 truncate">{label}</span>
        {note ? <span className="site-bar-k max-md:hidden">{note}</span> : null}
        {/* Below xl, which of how many (02 / 05), drawn by the sheet's counter; a tap opens the page's sections (components/marketing/site-index.tsx). */}
        <button type="button" data-site-sections-open="" aria-haspopup="dialog" className="site-bar-count -my-2 -mr-3 inline-flex min-h-11 flex-row-reverse items-center gap-1.5 px-3 transition-colors hover:text-fg xl:hidden">
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
      </Container>
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  lead,
  aside,
  tone = "default",
  className,
}: {
  /** Only for a heading outside a barred section: a barred section's bar names it. */
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** A link or button that belongs with the heading rather than under it. */
  aside?: React.ReactNode;
  tone?: "default" | "inverse";
  className?: string;
}) {
  const inverse = tone === "inverse";
  return (
    <div className={cn("grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end", className)}>
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className={cn("nesto-eyebrow", inverse ? "text-graphite-fg/55" : "text-accent-strong")}>{eyebrow}</p>
        ) : null}
        <h2
          className={cn(
            "text-balance text-[32px] leading-[0.98] sm:text-[44px] lg:text-[56px] font-display",
            eyebrow && "mt-3",
            inverse ? "text-graphite-fg" : "text-fg",
          )}
        >
          <Dotted>{title}</Dotted>
        </h2>
        {lead ? (
          <p
            className={cn(
              "nesto-standfirst mt-4 max-w-2xl text-card leading-snug sm:text-[19px]",
              inverse && "text-graphite-fg/70",
            )}
          >
            {lead}
          </p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/**
 * A display heading ends on a gold square instead of its full stop. A heading
 * that ends on a question mark keeps it, and gets no square.
 */
export function Dotted({ children }: { children: React.ReactNode }) {
  if (typeof children !== "string") return <>{children}</>;
  if (/[?!:]$/.test(children)) return <>{children}</>;
  // The last word and the square stay on one line: a square alone on a line reads as a stray mark.
  const text = children.replace(/\.$/, "");
  const split = text.lastIndexOf(" ") + 1;
  return (
    <>
      {text.slice(0, split)}
      <span className="whitespace-nowrap">
        {text.slice(split)}
        <span aria-hidden="true" className="site-dot" />
      </span>
    </>
  );
}

/**
 * A page title band. Interior pages open with this rather than the hero, so a
 * visitor always knows which sheet they are on: the sheet's name in mono, the
 * title large with a gold full stop, a serif standfirst, and an ink rule
 * under all of it (UI-05 §4).
 */
export function PageIntro({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="bg-canvas">
      <Container className="pt-12 sm:pt-16 lg:pt-20">
        <div className="border-b-2 border-fg pb-10 sm:pb-12">
          <p className="nesto-eyebrow text-accent-strong">{eyebrow}</p>
          <h1 className="mt-5 max-w-5xl text-balance text-[44px] leading-[0.92] text-fg sm:text-[64px] lg:text-[84px] font-display">
            <Dotted>{title}</Dotted>
          </h1>
          {lead ? (
            <p className="nesto-standfirst mt-6 max-w-3xl text-[19px] leading-snug sm:text-[23px]">{lead}</p>
          ) : null}
          {children ? <div className="mt-8">{children}</div> : null}
        </div>
      </Container>
    </section>
  );
}

/**
 * The hairline grid (design spec §20, §81; UI-05 §9).
 *
 * Square cards separated by a single line, no gaps, no shadows, used for modules, roles, stages and
 * figures. The lines are drawn by each cell rather than by a coloured gap in
 * the container: a gap shows through wherever a row is not full, which turns a
 * missing card into a grey block. Drawn this way, a short last row simply ends.
 */
export const hairlineGrid = "grid border-l border-t border-line";
export const hairlineCell = "border-b border-r border-line bg-surface";

/**
 * Columns chosen so every row fills.
 *
 * Cell counts come from configuration and change as modules and roles are
 * added, so the column count is derived from the count rather than fixed —
 * eight cards never sit in a grid of three.
 */
export function gridColumns(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count % 4 === 0) return "sm:grid-cols-2 lg:grid-cols-4";
  if (count % 3 === 0) return "sm:grid-cols-2 lg:grid-cols-3";
  if (count % 2 === 0) return "sm:grid-cols-2";
  return "sm:grid-cols-2 lg:grid-cols-3";
}
