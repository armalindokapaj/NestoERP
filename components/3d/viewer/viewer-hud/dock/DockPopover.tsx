"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { useClickOutside } from "@/components/3d/viewer/hooks/useClickOutside";
import { cn } from "@/lib/3d/viewer/utils";

export function DockPopover({
  open,
  onClose,
  triggerRef,
  anchorClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  anchorClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, open, triggerRef);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "viewer-dropdown-in absolute bottom-full z-10 mb-2 rounded-control border border-fg/10 bg-surface p-1.5 shadow-[var(--shadow-2)]",
        anchorClassName
      )}
    >
      {children}
    </div>
  );
}
