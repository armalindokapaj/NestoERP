"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CompanyRef } from "@/lib/modules/sales/sales.types";
import { cn } from "@/lib/utils/cn";

/**
 * The `company` filter of a Sales page in the Group workspace (Workspace Context
 * §86, §87).
 *
 * A filter, not the workspace: it narrows what the group already reads and
 * writes only the `company` query parameter. The options are the companies the
 * server resolved for this person; whatever else the URL says, the server
 * checks it against the same list and ignores what is not there.
 */
export function GroupCompanyFilter({ companies, className }: { companies: CompanyRef[]; className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  if (companies.length < 2) return null;

  function change(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("company", value);
    else next.delete("company");
    next.delete("page");
    const query = next.toString();
    startTransition(() => router.push(query ? `?${query}` : "?", { scroll: false }));
  }

  return (
    <select
      aria-label="Company"
      value={searchParams.get("company") ?? ""}
      onChange={(event) => change(event.target.value)}
      className={cn(
        "h-10 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20",
        className,
      )}
    >
      <option value="">All companies</option>
      {companies.map((company) => (
        <option key={company.id} value={company.id}>
          {company.name}
        </option>
      ))}
    </select>
  );
}
