"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ArrowUpRight, ExternalLink, Link2, MoreHorizontal, Star } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import type { ProjectCardDTO } from "@/lib/modules/projects/project.types";

/**
 * The card's action menu (Projects Workspace Grid §56, §57).
 *
 * Opening, starring and sharing — what anybody who can see the card may do.
 * Editing, status and archiving live on the project's own page, where the
 * person has chosen the project; the gallery stays a place to find one.
 * Opening the menu never opens the project.
 */
export function ProjectCardMenu({ project, onToggleFavorite }: { project: ProjectCardDTO; onToggleFavorite: () => void }) {
  const toast = useToast();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(project.href, window.location.origin).toString());
      toast({ title: "Project link copied." });
    } catch {
      toast({ title: "The link could not be copied.", tone: "danger" });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Project actions for ${project.name}`}
          data-testid="project-menu"
          // 44 px where a finger aims it, 36 px under a mouse — keyed to the pointer, not the width, so touch tablets get 44 (§154; AUD-04 §3, MW-19).
          className="relative z-10 inline-flex size-9 items-center justify-center rounded-full border border-line/70 bg-surface/90 text-fg shadow-card backdrop-blur-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem asChild>
          <Link href={project.href} prefetch={false}>
            <ArrowUpRight />
            Open project
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={project.href} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            Open in new tab
          </a>
        </DropdownMenuItem>
        {project.canFavorite ? (
          <DropdownMenuItem onSelect={onToggleFavorite}>
            <Star />
            {project.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void copyLink()}>
          <Link2 />
          Copy project link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
