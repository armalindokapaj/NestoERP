import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        default: "border-line bg-surface-muted text-fg-muted",
        neutral: "border-line-strong bg-hover text-fg",
        success: "border-transparent bg-success-soft text-success-strong",
        warning: "border-transparent bg-warning-soft text-warning-strong",
        danger: "border-transparent bg-danger-soft text-danger-strong",
        info: "border-transparent bg-info-soft text-info-strong",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
