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
  return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)} {...props} />;
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

/**
 * The sheet reference in the margin — "03 / Roles".
 *
 * Borrowed from a drawing set rather than a deck: it gives the page a spine a
 * reader can navigate by, and it is the one ornament the site allows itself.
 */
export function SectionMark({
  step,
  label,
  tone = "default",
  className,
}: {
  step: string;
  label: string;
  tone?: "default" | "inverse";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "nesto-eyebrow flex items-center gap-2.5",
        tone === "inverse" ? "text-graphite-fg/55" : "text-fg-subtle",
        className,
      )}
    >
      <span className={tone === "inverse" ? "text-graphite-fg/80" : "text-accent-strong"}>{step}</span>
      <span aria-hidden="true" className={cn("h-px w-6", tone === "inverse" ? "bg-current opacity-40" : "bg-accent")} />
      <span>{label}</span>
    </p>
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

  return (
    <div className={cn("flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="max-w-2xl">
        {eyebrow ? (
          step ? (
            <SectionMark step={step} label={eyebrow} tone={tone} />
          ) : (
            <p className={cn("nesto-eyebrow", inverse ? "text-graphite-fg/55" : "text-fg-subtle")}>
              {eyebrow}
            </p>
          )
        ) : null}

        <h2
          className={cn(
            "mt-5 text-balance font-serif text-page font-normal leading-tight sm:text-display",
            inverse ? "text-graphite-fg" : "text-fg",
          )}
        >
          {title}
        </h2>

        {lead ? (
          <p
            className={cn(
              "mt-4 max-w-xl text-body leading-relaxed sm:text-card",
              inverse ? "text-graphite-fg/70" : "text-fg-muted",
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
 * A page title band. Interior pages open with this rather than the hero, so a
 * visitor always knows which sheet they are on.
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
    <section className="relative overflow-hidden border-b border-accent/25 bg-surface">
      <div aria-hidden="true" className="nesto-drafting-grid absolute inset-0" />
      <Container className="relative py-16 sm:py-20 lg:py-24">
        <p className="nesto-eyebrow text-accent-strong">{eyebrow}</p>
        <h1 className="mt-5 max-w-3xl text-balance font-serif text-page font-normal leading-tight text-fg sm:text-display">
          {title}
        </h1>
        {lead ? (
          <p className="mt-5 max-w-2xl text-body leading-relaxed text-fg-muted sm:text-card">{lead}</p>
        ) : null}
        {children ? <div className="mt-8">{children}</div> : null}
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
