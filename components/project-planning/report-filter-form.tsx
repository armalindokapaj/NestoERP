"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";

/**
 * The milestone report's filters (PRD #44 §165), sent as a guarded navigation
 * (AUD-03 §4): the same page with other filters replaces the planning settings
 * form below it, so a change there is asked about in the app's own prompt
 * rather than lost to a full reload. The query string is what the native GET
 * submit would have sent.
 *
 * Below sm the fields fold behind a "Filters" toggle that names how many are
 * applied, so the report is not pushed off a phone screen by seven stacked
 * controls (AUD-04 §5, MW-06). The fields stay one tree whatever the width —
 * turning the phone keeps what was typed — and Apply is still the one submit.
 */
export function ReportFilterForm({ children, activeCount = 0, ...props }: Omit<React.ComponentProps<"form">, "onSubmit" | "method" | "action"> & { activeCount?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  return (
    <form
      method="get"
      {...props}
      onSubmit={(event) => {
        event.preventDefault();
        const query = new URLSearchParams();
        for (const [name, value] of new FormData(event.currentTarget)) if (typeof value === "string") query.append(name, value);
        const search = query.toString();
        router.push(search ? `${pathname}?${search}` : pathname);
      }}
    >
      <div className="flex w-full items-center justify-between gap-3 sm:hidden">
        <span className="text-table font-medium text-fg">{activeCount ? `Filters · ${activeCount} applied` : "Filters"}</span>
        <Button type="button" size="sm" variant="secondary" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)} data-testid="report-filters-toggle">
          {open ? "Hide filters" : "Show filters"}
        </Button>
      </div>
      <div id={bodyId} className={open ? "contents" : "contents max-sm:hidden"}>
        {children}
      </div>
    </form>
  );
}
