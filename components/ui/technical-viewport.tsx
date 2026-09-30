import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A viewport for canvases that must not be squeezed into page constraints:
 * 3D, CAD, drawings (MOB-01 §46). No gutters and no max width. It takes the
 * full width and the height left under the shell's sticky stack (dynamic
 * viewport units, with a `vh` fallback), so it follows orientation changes and
 * the browser chrome. Overlay controls go in `TechnicalViewportOverlay`, which
 * keeps them clear of the notch and the home indicator.
 */
export function TechnicalViewport({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-technical-viewport
      className={cn("nesto-technical-viewport relative isolate w-full min-w-0 overflow-hidden overscroll-contain bg-surface-muted [touch-action:none]", className)}
      {...props}
    />
  );
}

const anchors = {
  "top-left": "top-0 left-0",
  "top-right": "top-0 right-0",
  "bottom-left": "bottom-0 left-0",
  "bottom-right": "bottom-0 right-0",
  "top-center": "top-0 left-1/2 -translate-x-1/2",
  "bottom-center": "bottom-0 left-1/2 -translate-x-1/2",
} as const;

export function TechnicalViewportOverlay({
  anchor = "top-left",
  className,
  ...props
}: React.ComponentProps<"div"> & { anchor?: keyof typeof anchors }) {
  return (
    <div
      className={cn(
        "absolute z-[1] flex max-w-full gap-2 p-3",
        "pt-[max(0.75rem,var(--nesto-safe-top))] pb-[max(0.75rem,var(--nesto-safe-bottom))] pl-[max(0.75rem,var(--nesto-safe-left))] pr-[max(0.75rem,var(--nesto-safe-right))]",
        anchors[anchor],
        className,
      )}
      {...props}
    />
  );
}
