import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { warnUnnamedIconControl } from "@/lib/a11y/accessible-name";
import { cn } from "@/lib/utils/cn";

/*
 * The button (UI-02 §9.1, §9.2, §10.1). The two design-system versions differ
 * through tokens — the radius, the heights, a secondary button's boundary, the
 * pressed fills (styles/tokens.css, tokens-v2.css) — and through `ds2:` only
 * where version 1 has no such state: pressed feedback, which version 2 shows
 * on the next frame (`ds2:active:transition-none`), and a danger hover that is
 * a fill of its own rather than a fade. Nothing lifts, scales or moves.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-(--nesto-radius-button) font-medium transition-colors ds2:active:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
    "disabled:pointer-events-none disabled:opacity-50",
    // Busy (`loading`) is not `disabled`, so it keeps focus; it reads and refuses the pointer the same way (§10.1).
    // Its own marker, because callers also set `aria-busy` on a button they have disabled themselves.
    "data-[busy]:pointer-events-none data-[busy]:opacity-50 ds2:data-[busy]:relative",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover ds2:active:bg-primary-pressed",
        secondary: "border border-button-line bg-surface text-fg hover:bg-hover ds2:active:bg-pressed",
        ghost: "text-fg-muted hover:bg-hover hover:text-fg ds2:active:bg-pressed",
        subtle: "bg-hover text-fg hover:bg-line ds2:active:bg-pressed",
        // Gold is not a fill for an action in version 2 (§6.1): there this is the primary button.
        accent:
          "bg-accent text-accent-fg hover:opacity-90 ds2:bg-primary ds2:text-primary-fg ds2:hover:bg-primary-hover ds2:hover:opacity-100 ds2:active:bg-primary-pressed",
        // danger-fg: white on the light red, near-black on the dark one; both >= 4.5:1 (AUD-11 AV-10).
        // Version 2 moves the fill away from its text instead of fading both (contrast-pairs.ts).
        danger: "bg-danger text-danger-fg hover:opacity-90 ds2:hover:bg-danger-hover ds2:hover:opacity-100 ds2:active:bg-danger-pressed",
        link: "text-accent-strong underline-offset-4 hover:underline",
      },
      /*
       * Touch (AUD-04 §3, MW-19): every size is at least 44×44 under `touch:`
       * — below lg, or on a coarse pointer — while a desktop mouse keeps the
       * dense 32/36px controls (MW-21). Icons stay 16px inside the larger box.
       *
       * The heights are tokens: 32/36/44px in version 1; in version 2 the
       * middle step is the control height of the density, 40px or 32px compact
       * (UI-02 §6.4), and the icon of an ordinary control is 20px (§6.3) —
       * icon-only or beside a label. The small sizes are the dense ones and
       * keep 16px, as does compact density.
       */
      size: {
        sm: "h-(--nesto-height-action-sm) px-3 text-table [&_svg]:size-4 touch:h-11 touch:min-w-11",
        md: "h-(--nesto-height-action) px-4 text-body [&_svg]:size-(--nesto-size-action-icon) touch:h-11 touch:min-w-11",
        lg: "h-(--nesto-height-action-lg) px-5 text-body [&_svg]:size-(--nesto-size-action-icon) touch:h-11 touch:min-w-11",
        icon: "size-(--nesto-height-action) [&_svg]:size-(--nesto-size-action-icon) touch:size-11",
        "icon-sm": "size-(--nesto-height-action-sm) [&_svg]:size-4 touch:size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * Busy (MOB-01 §14, UI-02 §10.1): a spinner, `aria-busy`, and no second
     * activation — by `aria-disabled` and a click guard rather than `disabled`,
     * so the button keeps keyboard focus while it works. In version 2 the
     * spinner takes the label's place and the button keeps its width.
     * Client state: a busy button carries a handler, so it cannot be rendered
     * by a Server Component. Ignored with `asChild`.
     */
    loading?: boolean;
  };

/** A busy button's only handler: a click, Enter, Space or a form's implicit submit does nothing. */
function refuseActivation(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
}

export function Button({ className, variant, size, asChild = false, loading = false, children, disabled, onClick, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  // Icon-only sizes need a contextual name; development warns (AUD-11 §3, AV-06).
  if (process.env.NODE_ENV !== "production" && (size === "icon" || size === "icon-sm")) warnUnnamedIconControl("Button", props);
  // Marked so a dialog never lands initial focus on it (AUD-11 §4, AV-05; lib/a11y/overlay-focus.ts).
  const busy = loading && !asChild;
  return (
    <Comp
      data-variant={variant === "danger" ? "danger" : undefined}
      data-busy={busy ? "" : undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? refuseActivation : onClick}
      {...props}
    >
      {busy ? (
        <>
          {/* Version 2: centred over the label, which keeps its room and its name (opacity, not visibility). */}
          <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none ds2:absolute ds2:inset-0 ds2:m-auto" />
          <span className="contents ds2:inline-flex ds2:items-center ds2:gap-2 ds2:opacity-0">{children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { buttonVariants };
