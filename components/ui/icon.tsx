import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * Icon (design spec §70, §88).
 *
 * One library (Lucide) and three sizes — 16 / 18 / 20. Routing icons through
 * here is what stops a second icon family or a 23px icon appearing later.
 */
const sizeClasses = {
  sm: "size-4", // 16px — inline with body text, table cells, buttons
  md: "size-[18px]", // 18px — navigation, top bar controls
  lg: "size-5", // 20px — page and section headers
} as const;

export type IconSize = keyof typeof sizeClasses;

export function Icon({
  icon: Component,
  size = "sm",
  className,
  ...props
}: {
  icon: LucideIcon;
  size?: IconSize;
} & Omit<React.ComponentProps<LucideIcon>, "size">) {
  return (
    <Component
      aria-hidden="true"
      className={cn(sizeClasses[size], "shrink-0", className)}
      {...props}
    />
  );
}

export { sizeClasses as iconSizeClasses };
