import * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg",
        "placeholder:text-fg-subtle",
        "transition-colors focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/25",
        className,
      )}
      {...props}
    />
  );
}
