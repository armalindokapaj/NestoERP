"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Film, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { ProjectMediaDTO } from "@/lib/modules/project-media/project-media.types";

function durationLabel(seconds: number | null): string | null {
  if (!seconds) return null;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ProjectMediaGallery({ items, type }: { items: ProjectMediaDTO[]; type: "renders" | "animations" }) {
  const [selected, setSelected] = React.useState<number | null>(null);
  const current = selected === null ? null : items[selected];

  const move = React.useCallback((step: number) => {
    setSelected((index) => index === null ? null : (index + step + items.length) % items.length);
  }, [items.length]);

  React.useEffect(() => {
    if (selected === null || type !== "renders") return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [move, selected, type]);

  if (items.length === 0) return null;

  return (
    <>
      <ul className={type === "renders" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-4 lg:grid-cols-2"} aria-label={type === "renders" ? "Project renders" : "Project animations"}>
        {items.map((item, index) => (
          <li key={item.id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            {type === "renders" ? (
              <button type="button" className="group block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => setSelected(index)} aria-label={`Open render ${item.title}`}>
                <div className="aspect-[4/3] overflow-hidden bg-surface-muted">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated media route cannot be fetched by the image optimizer.
                    <img src={item.thumbnailUrl} alt={item.title} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
                  ) : null}
                </div>
                <div className="p-4">
                  <p className="font-medium text-fg">{item.title}</p>
                  {item.description ? <p className="mt-1 line-clamp-2 text-table text-fg-muted">{item.description}</p> : null}
                </div>
              </button>
            ) : (
              <div>
                <div className="relative aspect-video bg-neutral-950">
                  <video className="h-full w-full object-contain" controls preload="metadata" poster={item.thumbnailUrl ?? undefined} aria-label={item.title}>
                    <source src={item.contentUrl} type={item.document.mimeType ?? undefined} />
                    Your browser cannot play this video.
                  </video>
                  {!item.thumbnailUrl ? <Film aria-hidden="true" className="pointer-events-none absolute left-4 top-4 size-5 text-white/40" /> : null}
                </div>
                <div className="flex items-start justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium text-fg">{item.title}</p>
                    {item.description ? <p className="mt-1 line-clamp-2 text-table text-fg-muted">{item.description}</p> : null}
                  </div>
                  {durationLabel(item.durationSeconds) ? <span className="shrink-0 rounded-full bg-surface-muted px-2 py-1 text-meta tabular-nums text-fg-muted">{durationLabel(item.durationSeconds)}</span> : null}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={current !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-6xl p-4 sm:p-6">
          <DialogTitle>{current?.title ?? "Project render"}</DialogTitle>
          <DialogDescription>{current?.description ?? `${selected === null ? 0 : selected + 1} of ${items.length}`}</DialogDescription>
          {current ? (
            <div className="relative mt-4 flex max-h-[75dvh] min-h-64 items-center justify-center overflow-hidden rounded-xl bg-neutral-950">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, authorized content route. */}
              <img src={current.contentUrl} alt={current.title} className="max-h-[75dvh] max-w-full object-contain" />
              {items.length > 1 ? (
                <>
                  <Button type="button" size="icon" variant="secondary" className="absolute left-3" onClick={() => move(-1)} aria-label="Previous render"><ChevronLeft /></Button>
                  <Button type="button" size="icon" variant="secondary" className="absolute right-3" onClick={() => move(1)} aria-label="Next render"><ChevronRight /></Button>
                </>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="justify-between">
            <span className="mr-auto text-meta text-fg-subtle">{selected === null ? "" : `${selected + 1} of ${items.length}`} · Use arrow keys to navigate</span>
            <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AnimationPreviewIcon() {
  return <span className="grid size-11 place-items-center rounded-full bg-black/60 text-white"><Play className="ml-0.5 size-5 fill-current" aria-hidden="true" /></span>;
}
