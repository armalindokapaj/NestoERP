"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * The star on a project card (Projects Workspace Grid §31, §49, §51, §52, §162).
 *
 * Presentational: the Projects page owns the request, so the star and the
 * menu's "Add to favorites" are one action. It never navigates — the card
 * underneath is a link, so the click stops here — and it never reorders the
 * gallery or grants anything (§32, §124).
 */
export function ProjectFavoriteButton({
  projectName,
  isFavorite,
  pending,
  onToggle,
}: {
  projectName: string;
  isFavorite: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!pending) onToggle();
      }}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? `Remove ${projectName} from favorites` : `Add ${projectName} to favorites`}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      data-testid="project-favorite"
      data-pending={pending ? "true" : undefined}
      // 44 px where a finger aims it, 36 px under a mouse — keyed to the pointer, not the width, so touch tablets get 44 (§153, §154; AUD-04 §3, MW-19).
      className="relative z-10 inline-flex size-9 items-center justify-center rounded-full border border-line/70 bg-surface/90 text-fg shadow-card backdrop-blur-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
    >
      <Star aria-hidden="true" className={cn("size-4 transition-colors", isFavorite ? "fill-warning text-warning" : "")} />
    </button>
  );
}
