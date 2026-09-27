"use client";

import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/3d/viewer/utils";

export const DockShell = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(function DockShell(
  { children, className },
  ref
) {
  return (
    <div
      ref={ref}
      data-viewer-dock=""
      className={cn("viewer-glass relative flex h-auto items-stretch rounded-[16px] lg:h-[62px]", className)}
      style={{ background: "rgba(12, 14, 18, 0.96)" }}
    >
      {children}
    </div>
  );
});
