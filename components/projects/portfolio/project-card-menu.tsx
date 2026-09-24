"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Archive, ArrowUpRight, Link2, MoreHorizontal, PenLine, RefreshCw, Star } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import type { PortfolioProjectDTO } from "@/lib/modules/projects/project.types";
import { cn } from "@/lib/utils/cn";

/**
 * The card's action menu (E-05A §33).
 *
 * Every item is derived from the permissions the server attached to this
 * project in its own company — nothing here asks what role somebody holds.
 * Opening the menu never opens the project.
 */
export function ProjectCardMenu({
  project,
  onToggleFavorite,
  onChangeStatus,
  onArchive,
  variant = "overlay",
}: {
  project: PortfolioProjectDTO;
  onToggleFavorite: () => void;
  onChangeStatus: () => void;
  onArchive: () => void;
  variant?: "overlay" | "inline";
}) {
  const toast = useToast();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(project.href, window.location.origin).toString());
      toast({ title: "Project link copied." });
    } catch {
      toast({ title: "The link could not be copied.", tone: "danger" });
    }
  }

  const canChangeStatus = project.permissions.manageStatus && project.statusMoves.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Actions for ${project.name}`}
          data-testid="project-menu"
          className={cn(
            "relative z-10 inline-flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            variant === "overlay"
              ? "size-9 border border-line/70 bg-surface/90 text-fg shadow-card backdrop-blur-sm hover:bg-surface"
              : "size-8 text-fg-subtle hover:bg-hover hover:text-fg",
          )}
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
        {project.permissions.favorite ? (
          <DropdownMenuItem onSelect={onToggleFavorite}>
            <Star />
            {project.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void copyLink()}>
          <Link2 />
          Copy project link
        </DropdownMenuItem>

        {project.permissions.edit || canChangeStatus ? <DropdownMenuSeparator /> : null}
        {project.permissions.edit ? (
          <DropdownMenuItem asChild>
            <Link href={`${project.href}/edit`} prefetch={false}>
              <PenLine />
              Edit project
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canChangeStatus ? (
          <DropdownMenuItem onSelect={onChangeStatus}>
            <RefreshCw />
            Change status…
          </DropdownMenuItem>
        ) : null}

        {project.permissions.archive ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onArchive}>
              <Archive />
              Archive project…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
