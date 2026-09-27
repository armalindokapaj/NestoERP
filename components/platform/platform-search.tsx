"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Search, X } from "lucide-react";

type Result = { type: string; id: string; title: string; subtitle: string; href: string };

export function PlatformSearch() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [loading, setLoading] = React.useState(false);
  // The results close on Escape and when focus leaves the search; typing opens them again (AUD-04 §6, D-09-18, MW-10).
  const [open, setOpen] = React.useState(true);

  React.useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/platform-admin/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const json = await response.json() as { data?: Result[] };
        setResults(json.data ?? []);
      } finally { setLoading(false); }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  return (
    <div
      className="relative w-full min-w-0 max-w-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
      <input value={query} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} placeholder="Search NESTO Platform…" aria-label="Search NESTO Platform" className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-9 text-body text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-ring/20" />
      {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid -translate-y-1/2 place-items-center rounded p-1 text-fg-subtle hover:bg-hover touch:right-0 touch:size-11 touch:p-0"><X className="size-4" /></button> : null}
      {open && query.trim().length >= 2 ? (
        // Never taller than the screen under the header, so the last result can be reached on a landscape phone.
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[min(420px,calc(100dvh-5rem))] overflow-auto overscroll-contain rounded-xl border border-line bg-surface p-2 shadow-xl">
          {loading ? <p className="px-3 py-4 text-table text-fg-muted">Searching…</p> : results.length ? results.map((result) => (
            <Link key={`${result.type}:${result.id}`} href={result.href} onClick={() => setQuery("")} className="flex items-start justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-hover">
              <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block text-body font-medium text-fg">{result.title}</span><span className="block text-meta text-fg-subtle">{result.subtitle}</span></span>
              <span className="rounded bg-surface-muted px-2 py-0.5 text-micro text-fg-muted">{result.type}</span>
            </Link>
          )) : <p className="px-3 py-4 text-table text-fg-muted">No platform records found.</p>}
        </div>
      ) : null}
    </div>
  );
}
