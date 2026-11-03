import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * A tag (UI-02 §10.3): a plain label for a category, a keyword or an applied
 * filter. Not a status — that is Badge, whose colour means something — so it
 * has one neutral look and the small radius (§6.3: 4px in version 2).
 *
 * It does nothing unless its removal is explicit: `onRemove` adds a button,
 * and `removeLabel` names it after the tag ("Remove Structural"), because a
 * row of buttons all called "Remove" says nothing to a screen reader. The
 * button is 24px with a mouse and a 44px hit area under touch, the visible
 * mark unchanged (AUD-04 §3).
 */
export type TagProps = Omit<React.ComponentProps<"span">, "children"> & {
  children: React.ReactNode;
} & ({ onRemove?: undefined; removeLabel?: undefined } | { onRemove: () => void; removeLabel: string });

export function Tag({ className, children, onRemove, removeLabel, ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1 rounded-sm border border-line bg-surface-muted px-2 text-meta font-medium text-fg",
        onRemove && "pr-0",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg ds2:active:bg-pressed ds2:active:transition-none touch:after:absolute touch:after:-inset-2.5 touch:after:content-['']"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}
