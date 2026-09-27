import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

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
        danger: "bg-danger text-white hover:opacity-90",
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
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
