import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Minimal styled radio — grouped with a native fieldset by the caller.
 *
 * A native radio draws no pseudo-elements, so its touch hit area comes from
 * the `<label>` the caller wraps it in; under touch that label is at least
 * 44px tall when it uses `touch:min-h-11` (AUD-04 §3). The control itself
 * grows a little so it is easier to see where to press.
 */
export function Radio({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="radio"
      className={cn(
        "size-4 shrink-0 accent-[var(--nesto-accent)] disabled:cursor-not-allowed disabled:opacity-50 touch:size-5",
        className,
      )}
      {...props}
    />
  );
}
