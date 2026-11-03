"use client";

import * as React from "react";
import { useSelectedLayoutSegments } from "next/navigation";

/**
 * The group area's loading boundary (UI-02 §16.1, §22.1): while a group page
 * is on its way the shell stays — header, sections, account — and the page's
 * place shows a skeleton. Keyed by the route, so every page gets a boundary of
 * its own and a page that is opening is never hidden behind the one before it.
 *
 * Mounted by app/group/layout.tsx under version 2 only. A `loading.tsx` would
 * do the same for both versions, and version 1's group pages have none: there
 * a page still arrives whole.
 */
export function GroupPageBoundary({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  const route = useSelectedLayoutSegments().join("/");
  return (
    <React.Suspense key={route} fallback={fallback}>
      {children}
    </React.Suspense>
  );
}
