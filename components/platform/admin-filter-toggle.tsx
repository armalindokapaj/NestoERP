"use client";

import * as React from "react";
import { ChevronDown, SlidersHorizontal } from "@/components/icons";

import { cn } from "@/lib/utils/cn";

/**
 * A list's less-used filters, folded away on a phone behind one line —
 * "Filters", with how many are set — so the rows start on the first screen.
 * From 640px they are always shown, in the form's own row. The children keep
 * their place in the form's layout (`contents`).
 */
export function AdminFilterToggle({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className="col-span-2 flex h-11 items-center gap-2 border border-line-strong bg-surface px-3 text-table font-medium text-fg sm:hidden"
      >
        <SlidersHorizontal aria-hidden="true" className="size-4 text-fg-subtle" />
        <span className="flex-1 text-left">{label}</span>
        {count > 0 ? <span className="grid h-5 min-w-5 place-items-center bg-primary px-1 font-mono text-micro tabular-nums text-primary-fg">{count}</span> : null}
        <ChevronDown aria-hidden="true" className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      <div id={id} className={cn("contents", !open && "max-sm:hidden")}>
        {children}
      </div>
    </>
  );
}
