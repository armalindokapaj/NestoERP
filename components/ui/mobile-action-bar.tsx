import type * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A page's actions on a phone (docs/ui/UI-04-navigation-layouts.md §Phone):
 * they stay with the page, never floating over the phone's bar.
 *
 * - `MainAction` — a detail page's main action (Complete, Approve / Reject,
 *   Submit …), wrapped where the page's header actions draw it: beside the
 *   page's title at every width. Secondary actions are not wrapped: they stay
 *   in the page's ⋯ (components/navigation/page-menu.tsx).
 * - `MobileActionBar` — a form's Save / Cancel, as the form's last row. On a
 *   phone each button takes its share of the row, 48px tall, where the thumb
 *   finishes the form.
 */
export function MainAction({ children }: { children: React.ReactNode }) {
  return (
    <div data-main-action="" className="contents">
      {children}
    </div>
  );
}

/** A form's action row: the form's footer, its buttons sharing the row below md. `className` aligns it from md. */
export function MobileActionBar({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-form-actions=""
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 py-3",
        // Save and Cancel share the row on a phone; an empty unsaved note takes no room.
        "max-md:[&>a]:flex-1 max-md:[&>button]:min-h-12 max-md:[&>button]:min-w-0 max-md:[&>button]:flex-1 max-md:[&>span:empty]:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
