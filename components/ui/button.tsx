import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { warnUnnamedIconControl } from "@/lib/a11y/accessible-name";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover",
        secondary: "border border-line-strong bg-surface text-fg hover:bg-hover",
        ghost: "text-fg-muted hover:bg-hover hover:text-fg",
        subtle: "bg-hover text-fg hover:bg-line",
        accent: "bg-accent text-accent-fg hover:opacity-90",
        // danger-fg: white on the light red, near-black on the dark one; both >= 4.5:1 (AUD-11 AV-10).
        danger: "bg-danger text-danger-fg hover:opacity-90",
        link: "text-accent-strong underline-offset-4 hover:underline",
      },
      /*
       * Touch (AUD-04 §3, MW-19): every size is at least 44×44 under `touch:`
       * — below lg, or on a coarse pointer — while a desktop mouse keeps the
       * dense 32/36px controls (MW-21). Icons stay 16px inside the larger box.
       */
      size: {
        sm: "h-8 px-3 text-table [&_svg]:size-4 touch:h-11 touch:min-w-11",
        md: "h-9 px-4 text-body [&_svg]:size-4 touch:h-11 touch:min-w-11",
        lg: "h-11 px-5 text-body [&_svg]:size-4 touch:min-w-11",
        icon: "size-9 [&_svg]:size-4 touch:size-11",
        "icon-sm": "size-8 [&_svg]:size-4 touch:size-11",
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
    /** Busy: disables the button, shows a spinner, keeps its width (MOB-01 §14). Ignored with `asChild`. */
    loading?: boolean;
  };

export function Button({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  // Icon-only sizes need a contextual name; development warns (AUD-11 §3, AV-06).
  if (process.env.NODE_ENV !== "production" && (size === "icon" || size === "icon-sm")) warnUnnamedIconControl("Button", props);
  // Marked so a dialog never lands initial focus on it (AUD-11 §4, AV-05; lib/a11y/overlay-focus.ts).
  const busy = loading && !asChild;
  return (
    <Comp
      data-variant={variant === "danger" ? "danger" : undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {asChild ? children : (
        <>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

export { buttonVariants };
