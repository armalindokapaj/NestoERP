import * as React from "react";

import { cn } from "@/lib/utils/cn";

const statusRail = {
  success: "before:bg-success",
  warning: "before:bg-warning",
  danger: "before:bg-danger",
  info: "before:bg-info",
} as const;

/**
 * The card (MOB-01 §17). Padding follows `--nesto-space-card` (16 on a phone,
 * 20 from 640), never a fixed desktop width. Optional states:
 *
 * - `interactive`: the whole card is a target — hover, pressed and a focus ring
 *   (give it `tabIndex`/role or wrap a link; the class only styles it);
 * - `selected` / `disabled`: `aria-selected`-style ring, muted and inert;
 * - `compact`: tighter padding for dense columns;
 * - `status`: a 3px leading rail. It repeats what a visible label says and
 *   never carries meaning alone;
 * - `loading`: `aria-busy`, content dimmed.
 *
 * Two behaviours (UI-02 §9.1, §11.1, §11.2). A card is informational unless it
 * says otherwise: no pointer cursor, no hover styling, and only the controls
 * inside it take focus. `navigable` is the card that opens something:
 *
 *   <Card as="article" navigable>
 *     <CardHeader>
 *       <CardTitle as="h3"><CardLink href="/projects/p1">Tirana Tower</CardLink></CardTitle>
 *       <CardControls><ProjectMenu /></CardControls>
 *     </CardHeader>
 *   </Card>
 *
 * `CardLink` (card-link.tsx) is the card's one destination, an ordinary anchor
 * stretched over the card, so a click anywhere opens it and open-in-new-tab
 * still works; `CardControls` lifts a menu or a checkbox above it. Never a
 * button inside an anchor. Hover strengthens the border and shows a short gold
 * rule; keyboard focus on the link rings the whole card; nothing lifts or
 * moves (§9.2).
 *
 * In version 2 the card itself is a border and a surface, with no shadow, an
 * 8px radius and 16px padding, 12px in compact density (§6.3) — all tokens.
 */
export function Card({
  className,
  as = "div",
  interactive,
  navigable,
  selected,
  disabled,
  compact,
  loading,
  status,
  ...props
}: React.ComponentProps<"div"> & {
  /** The element: `article` for a record in a gallery, `li` inside a list, `section` for a titled panel. */
  as?: "div" | "article" | "section" | "li";
  interactive?: boolean;
  /** The card opens its `CardLink`. Hover and focus styling only: the link is the control. */
  navigable?: boolean;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
  loading?: boolean;
  status?: keyof typeof statusRail;
}) {
  // One set of props for whichever element: each is a plain block container.
  const Element = as as "div";
  return (
    <Element
      data-compact={compact ? "" : undefined}
      // The selected look is `.nesto-card[data-selected]`, in version 2 only (styles/tokens-v2.css).
      data-selected={selected ? "" : undefined}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        "nesto-card group/card min-w-0",
        interactive && !disabled && "cursor-pointer transition-colors hover:bg-row-hover active:bg-hover focus-visible:outline-2 ds2:active:bg-pressed ds2:active:transition-none",
        navigable && [
          "relative transition-colors hover:border-line-strong",
          // The rule sits where the card's padding starts, inside the top border; decoration, so it is the gold that is never text (§6.1).
          "after:pointer-events-none after:absolute after:left-(--nesto-space-card) after:top-0 after:h-0.5 after:w-8 after:bg-gold after:opacity-0 after:transition-opacity after:content-[''] hover:after:opacity-100",
          // The link draws no ring of its own: the card it covers does.
          "has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-2 has-[[data-card-link]:focus-visible]:outline-ring has-[[data-card-link]:focus-visible]:after:opacity-100",
        ],
        disabled && "pointer-events-none opacity-60",
        loading && "opacity-70",
        status && ["relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']", statusRail[status]],
        className,
      )}
      {...props}
    />
  );
}

/**
 * A navigable card's other controls — a menu, a checkbox, a second action —
 * above the stretched link, so using one never opens the record (UI-02 §11.2).
 */
export function CardControls({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("relative z-[1] flex shrink-0 items-center gap-1", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 px-[var(--nesto-space-card)] pt-(--nesto-space-card-y) pb-3 group-data-[compact]/card:pt-3 group-data-[compact]/card:pb-2", className)}
      {...props}
    />
  );
}

/**
 * A card's heading (AUD-11 §3, AV-02). An h2 by default, because a card sits
 * directly under the page's h1; `as` picks the level that fits the outline
 * ("h3" for a card inside a titled section, "p" for a label that is not a
 * heading). The look is the same whatever the element: the level is structure,
 * never font size.
 */
export function CardTitle({
  className,
  as: Heading = "h2",
  ...props
}: React.ComponentProps<"h2"> & { as?: "h2" | "h3" | "h4" | "p" }) {
  return <Heading className={cn("text-card font-semibold text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-0.5 text-table text-fg-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-[var(--nesto-space-card)] pb-[var(--nesto-space-card)] group-data-[compact]/card:pb-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 border-t border-line px-[var(--nesto-space-card)] py-3", className)}
      {...props}
    />
  );
}
