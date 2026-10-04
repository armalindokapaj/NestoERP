"use client";

import { ChevronDown } from "lucide-react";
import { useDropdown } from "@/components/3d/viewer/hooks/useDropdown";
import { DropdownPanel } from "@/components/3d/viewer/shared/Dropdown";
import { cn } from "@/lib/3d/viewer/utils";

export function FilterDropdown({
  label,
  active = false,
  panelClassName,
  className,
  align = "left",
  children,
}: {
  label: React.ReactNode;
  active?: boolean;
  panelClassName?: string;
  className?: string;
  align?: "left" | "right";
  children: (close: () => void) => React.ReactNode;
}) {
  const { open, toggle, close, ref } = useDropdown<HTMLDivElement>();

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-control border border-line-strong bg-surface px-3 text-sm font-semibold transition-colors",
          active || open
            ? "border-line-strong text-fg shadow-[var(--shadow-1)]"
            : "text-fg-muted hover:border-line-strong hover:text-fg"
        )}
      >
        {label}
        {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <DropdownPanel align={align} width="w-full" className={panelClassName}>
          {children(close)}
        </DropdownPanel>
      )}
    </div>
  );
}
