import * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-fg",
        "placeholder:text-fg-subtle",
        "transition-colors focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
