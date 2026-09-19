"use client";

import * as React from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

type Result = { type: string; id: string; title: string; subtitle: string; href: string };

export function PlatformSearch() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [loading, setLoading] = React.useState(false);

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
    <div className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search NESTO Platform…" aria-label="Search NESTO Platform" className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-9 text-body text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-ring/20" />
      {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:bg-hover"><X className="size-4" /></button> : null}
      {query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[420px] overflow-auto rounded-xl border border-line bg-surface p-2 shadow-xl">
          {loading ? <p className="px-3 py-4 text-table text-fg-muted">Searching…</p> : results.length ? results.map((result) => (
            <Link key={`${result.type}:${result.id}`} href={result.href} onClick={() => setQuery("")} className="flex items-start justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-hover">
              <span><span className="block text-body font-medium text-fg">{result.title}</span><span className="block text-meta text-fg-subtle">{result.subtitle}</span></span>
              <span className="rounded bg-surface-muted px-2 py-0.5 text-micro text-fg-muted">{result.type}</span>
            </Link>
          )) : <p className="px-3 py-4 text-table text-fg-muted">No platform records found.</p>}
        </div>
      ) : null}
    </div>
  );
}
