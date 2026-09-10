"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * SearchField (design spec §16, §89).
 *
 * The single search input style in the product. Search itself is not built in
 * V0.1, so callers pass `disabled` and the field explains itself rather than
 * silently swallowing what the user types.
 */
export function SearchField({
  className,
  shortcut,
  ...props
}: React.ComponentProps<"input"> & { shortcut?: string }) {
  return (
    <div className={cn("relative w-full", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
      />
      <input
        type="search"
        className={cn(
          "h-10 w-full rounded-md border border-line bg-surface pl-9 text-body text-fg transition-colors",
          "placeholder:text-fg-subtle hover:border-line-strong",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20",
          "disabled:cursor-not-allowed disabled:bg-surface-muted",
          shortcut ? "pr-14" : "pr-3",
        )}
        {...props}
      />
      {shortcut ? (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-sans text-micro font-medium text-fg-subtle"
        >
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}
