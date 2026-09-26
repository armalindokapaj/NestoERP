"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A date window over a list (PRD #16 §94, §144).
 *
 * Writes `from` and `to` into the URL like every other NESTO filter, so
 * refresh, back/forward and a shared link all reproduce the same list. A leave
 * filter asks "was anybody off in this window", which the service answers as an
 * overlap rather than a containment.
 */
export function DateRangeFilter({
  label = "Dates",
  basePath,
}: {
  label?: string;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  function apply(next: { from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Any change to the result set returns to the first page.
    params.delete("page");
    const query = params.toString();
    startTransition(() => router.push(query ? `${basePath}?${query}` : basePath, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-end gap-2" data-pending={pending}>
      <div className="space-y-1">
        <Label htmlFor="filter-from" className="text-meta text-fg-subtle">
          {label} from
        </Label>
        <Input
          id="filter-from"
          type="date"
          className="h-10 w-40"
          value={from}
          onChange={(event) => apply({ from: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="filter-to" className="text-meta text-fg-subtle">
          to
        </Label>
        <Input
          id="filter-to"
          type="date"
          className="h-10 w-40"
          value={to}
          onChange={(event) => apply({ to: event.target.value })}
        />
      </div>
      {from || to ? (
        <Button variant="ghost" size="sm" onClick={() => apply({ from: "", to: "" })}>
          Clear dates
        </Button>
      ) : null}
    </div>
  );
}
