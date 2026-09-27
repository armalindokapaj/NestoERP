import * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        // 44px tall under touch (AUD-04 §3); the 16px phone font is one rule in globals.css.
        "h-10 w-full rounded-md border border-control bg-surface px-3 text-body text-fg touch:h-11",
        "placeholder:text-fg-subtle",
        // The boundary is the 3:1 control border; focus is a solid 2px ring, not a 25% tint (AUD-11 AV-04, AV-10).
        "transition-colors focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger",
        className,
      )}
      {...props}
    />
  );
}
