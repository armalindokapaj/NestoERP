import * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full border border-control bg-surface px-3 py-2 text-body text-fg",
        "placeholder:text-fg-subtle",
        // The boundary is the 3:1 control border; focus is a solid 2px ring (AUD-11 AV-04, AV-10).
        "transition-colors focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        // Version 2: read-only sits on the muted ground, like Input (UI-02 §9).
        // The same invalid state as Input (AUD-09 §6).
        "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger",
        className,
      )}
      {...props}
    />
  );
}
