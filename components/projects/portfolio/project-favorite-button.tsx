"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * The star on a project card or list row (E-05A §13, §25).
 *
 * Presentational: the Projects page owns the request, so the star and the
 * menu's "Add to favorites" are one action. It never navigates — the card
 * underneath is a link, so the click stops here.
 */
export function ProjectFavoriteButton({
  projectName,
  isFavorite,
  pending,
  onToggle,
  variant = "overlay",
}: {
  projectName: string;
  isFavorite: boolean;
  pending: boolean;
  onToggle: () => void;
  variant?: "overlay" | "inline";
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
      className={cn(
        "relative z-10 inline-flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "overlay"
          ? "size-9 border border-line/70 bg-surface/90 text-fg shadow-card backdrop-blur-sm hover:bg-surface"
          : "size-8 text-fg-subtle hover:bg-hover hover:text-fg",
      )}
    >
      <Star aria-hidden="true" className={cn("size-4 transition-colors", isFavorite ? "fill-warning text-warning" : "")} />
    </button>
  );
}
