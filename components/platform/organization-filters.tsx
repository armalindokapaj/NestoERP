"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { useRouter } from "@/components/navigation/guarded-router";

type Option = { value: string; label: string };

/**
 * Search, Status and Parent Group for the organization directory
 * (Organizations PRD §7, §10, §11). All of it lives in the address, so a
 * refresh, a shared link and Back/Forward keep it; typing is debounced and
 * replaces the entry rather than stacking history.
 */
export function OrganizationFilters({ statuses, groups, showGroup }: { statuses: Option[]; groups: Option[]; showGroup: boolean }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = React.useState(params.get("q") ?? "");

  const update = React.useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }, [params, pathname, router]);

  React.useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const timer = window.setTimeout(() => update({ q: q.trim() }), 300);
    return () => window.clearTimeout(timer);
  }, [q, params, update]);

  const select = "h-9 cursor-pointer rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter organizations">
      <div className="relative w-full sm:w-72">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search organizations..." aria-label="Search organizations" className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-8 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
        {q ? <button type="button" onClick={() => { setQ(""); update({ q: "" }); }} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded text-fg-subtle hover:bg-hover"><X className="size-3.5" /></button> : null}
      </div>
      <select aria-label="Status" value={params.get("status") ?? ""} onChange={(event) => update({ status: event.target.value })} className={select}>
        <option value="">All statuses</option>
        {statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {showGroup ? (
        <select aria-label="Parent Group" value={params.get("group") ?? ""} onChange={(event) => update({ group: event.target.value })} className={select}>
          <option value="">Any Parent Group</option>
          {groups.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : null}
    </div>
  );
}
