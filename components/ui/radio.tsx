import * as React from "react";

import { cn } from "@/lib/utils/cn";

/** Minimal styled radio — grouped with a native fieldset by the caller. */
export function Radio({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="radio"
      className={cn(
        "size-4 shrink-0 accent-[var(--nesto-accent)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
