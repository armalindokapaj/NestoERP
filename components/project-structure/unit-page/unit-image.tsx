"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A unit image, whole (E-05D §40, §88). The thumbnail pipeline crops to a
 * portrait cover, which cuts a landscape floor plan in half, so the thumbnail
 * only holds the place while a short-lived preview grant for the real image is
 * fetched — lazily, once the image scrolls into view. Both go through the
 * Documents download gate.
 */
export function UnitImage({ documentId, thumbnailHref, alt, className, fit = "cover", lazy = true }: { documentId: string; thumbnailHref: string | null; alt: string; className?: string; fit?: "cover" | "contain"; lazy?: boolean }) {
  const ref = React.useRef<HTMLImageElement>(null);
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    const element = ref.current;
    let cancelled = false;
    const load = () =>
      void fetch(`/api/documents/${documentId}/preview`, { method: "POST" })
        .then(async (response) => (response.ok ? ((await response.json()) as { url?: string }) : null))
        .then((grant) => !cancelled && grant?.url && setUrl(grant.url))
        .catch(() => undefined);
    if (!lazy || !element || typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [documentId, lazy]);

  const src = url ?? thumbnailHref;
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={alt} loading={lazy ? "lazy" : "eager"} className={cn("h-full w-full", fit === "cover" ? "object-cover" : "object-contain", className)} />;
}
