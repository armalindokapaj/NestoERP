import * as React from "react";

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

export function Section({
  tone = "canvas",
  bordered = true,
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  tone?: keyof typeof tones;
  bordered?: boolean;
  containerClassName?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden",
        tones[tone],
        bordered && "border-b border-line",
        tone === "graphite" && "border-graphite",
        className,
      )}
      {...props}
    >
      <Container className={cn("py-16 sm:py-20 lg:py-28", containerClassName)}>{children}</Container>
    </section>
  );
}

export function SectionHeader({
  step,
  eyebrow,
  title,
  lead,
  aside,
  tone = "default",
  className,
}: {
  step?: string;
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** A link or button that belongs with the heading rather than under it. */
  aside?: React.ReactNode;
  tone?: "default" | "inverse";
  className?: string;
}) {
  const inverse = tone === "inverse";
  // A numbered head is a sheet: the number in outline, the title, then a full ink rule (UI-05 §4).
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-4 lg:items-end",
        step ? "border-b-2 pb-5 sm:grid-cols-[96px_minmax(0,1fr)] lg:grid-cols-[120px_minmax(0,1fr)_auto]" : "lg:grid-cols-[minmax(0,1fr)_auto]",
        inverse ? "border-graphite-fg" : "border-fg",
        className,
      )}
    >
      {step ? (
        <span aria-hidden="true" className="nesto-numeral text-[72px] lg:text-[96px]">
          {step}
        </span>
      ) : null}
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className={cn("nesto-eyebrow", inverse ? "text-graphite-fg/55" : "text-accent-strong")}>{eyebrow}</p>
        ) : null}
        <h2
          className={cn(
            "mt-3 text-balance text-[32px] leading-[0.98] sm:text-[44px] lg:text-[52px] font-display",
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
      {aside ? <div className="shrink-0 sm:col-start-2 lg:col-start-auto">{aside}</div> : null}
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
 * The hairline grid (design spec §20, §81).
 *
 * Cards separated by a single line, used for modules, roles, stages and
 * figures. The lines are drawn by each cell rather than by a coloured gap in
 * the container: a gap shows through wherever a row is not full, which turns a
 * missing card into a grey block. Drawn this way, a short last row simply ends.
 */
export const hairlineGrid = "grid overflow-hidden rounded-xl border-l border-t border-line";
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
