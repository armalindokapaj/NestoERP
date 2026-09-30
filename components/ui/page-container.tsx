import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * The one page container (MOB-01 §10).
 *
 * Owns horizontal gutters (16 on a phone, 24 on a tablet, 32 on a wide
 * desktop, never less than the safe-area inset), the content width and the
 * vertical rhythm, so a module never recreates page margins. The values are
 * `--nesto-space-page-*` in styles/tokens.css and the rule is `.nesto-page` in
 * globals.css; nothing here depends on the viewport width in JavaScript.
 *
 * - `default` — centred, capped at `--nesto-content-max-width`.
 * - `wide` — gutters, no width cap.
 * - `full` — edge to edge, still clear of the safe areas (canvases, viewers).
 * - `compact` — tighter gutters and top padding for dense workspaces.
 *
 * `gutter="none"` is for a container placed inside one that already has
 * gutters. `min-w-0` is built in: a flex or grid child that holds a wide
 * child can otherwise push the page sideways.
 */
export type PageContainerVariant = "default" | "wide" | "full" | "compact";

export type PageContainerProps<T extends React.ElementType = "div"> = {
  variant?: PageContainerVariant;
  gutter?: "page" | "none";
  as?: T;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "variant">;

export function PageContainer<T extends React.ElementType = "div">({
  variant = "default",
  gutter = "page",
  as,
  className,
  ...props
}: PageContainerProps<T>) {
  const Comp: React.ElementType = as ?? "div";
  return <Comp data-variant={variant} data-gutter={gutter} className={cn("nesto-page", className)} {...props} />;
}
