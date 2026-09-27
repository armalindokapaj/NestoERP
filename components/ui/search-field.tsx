"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * SearchField (design spec §16, §89).
 *
 * The single search input style in the product. Search itself is not built in
 * V0.1, so callers pass `disabled` and the field explains itself rather than
 * silently swallowing what the user types.
 *
 * With `onClear`, a field that holds text offers a clear button, and Escape
 * clears it — or, when it is already empty, leaves it. The browser's own clear
 * control is hidden so there is only one.
 */
export function SearchField({
  className,
  shortcut,
  onClear,
  onKeyDown,
  ...props
}: React.ComponentProps<"input"> & { shortcut?: string; onClear?: () => void }) {
  const t = useTranslations("ui");
  const hasText = typeof props.value === "string" && props.value.length > 0;
  const clearable = Boolean(onClear) && hasText && !props.disabled;

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
      />
      <input
        type="search"
        className={cn(
          "h-10 w-full rounded-md border border-control bg-surface pl-9 text-body text-fg transition-colors touch:h-11",
          "placeholder:text-fg-subtle",
          // A solid 2px ring rather than a 20% tint (AUD-11 AV-04).
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:bg-surface-muted",
          onClear && "[&::-webkit-search-cancel-button]:appearance-none",
          shortcut || onClear ? "pr-14" : "pr-3",
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !onClear || event.key !== "Escape") return;
          event.preventDefault();
          if (hasText) onClear();
          else event.currentTarget.blur();
        }}
        {...props}
      />
      {clearable ? (
        <button
          type="button"
          onClick={(event) => {
            onClear?.();
            (event.currentTarget.previousElementSibling as HTMLInputElement | null)?.focus();
          }}
          aria-label={t("clearSearch")}
          // A 44px target under touch: flush with the field's right edge, the icon unchanged (AUD-04 §3).
          className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:right-0 touch:size-11"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : shortcut ? (
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
