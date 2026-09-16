"use client";

import * as React from "react";
import Image from "next/image";

import type { PortfolioProjectDTO } from "@/lib/modules/projects/project.types";
import { cn } from "@/lib/utils/cn";

/**
 * The 3:4 cover, or a placeholder that holds the same shape (E-05A §7.1, §8, §44).
 *
 * The thumbnail comes from the project's authorised cover endpoint, already
 * sized for a card, so it is served as it is rather than through the image
 * optimiser — which would fetch it without the reader's session. It loads
 * lazily into space the card has already reserved, so nothing shifts when it
 * arrives. A thumbnail that fails falls back to the placeholder rather than a
 * broken image.
 */
export function ProjectCover({ project, sizes, className }: { project: Pick<PortfolioProjectDTO, "id" | "name" | "cover">; sizes: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);

  if (project.cover && !failed) {
    return (
      <Image
        src={project.cover.thumbnailUrl}
        alt={`Cover image of ${project.name}`}
        fill
        sizes={sizes}
        unoptimized
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("object-cover", className)}
      />
    );
  }

  return <ProjectPlaceholder id={project.id} name={project.name} className={className} />;
}

const TONES = [
  "from-accent-soft to-surface-muted",
  "from-info-soft to-surface-muted",
  "from-success-soft to-surface-muted",
  "from-warning-soft to-surface-muted",
  "from-hover to-surface-muted",
];

/** The same project always gets the same tone, so a placeholder is still recognisable. */
function toneFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return TONES[hash % TONES.length]!;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

export function ProjectPlaceholder({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`No cover image for ${name}`}
      className={cn("absolute inset-0 overflow-hidden bg-gradient-to-br", toneFor(id), className)}
    >
      <span aria-hidden="true" className="absolute left-4 top-4 text-[2.75rem] font-semibold leading-none tracking-tight text-fg/15">
        {initialsOf(name)}
      </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 120 90"
        preserveAspectRatio="xMidYMax meet"
        className="absolute inset-x-0 bottom-0 h-1/2 w-full text-fg/15"
      >
        <g fill="none" stroke="currentColor" strokeWidth="0.9">
          <path d="M6 90V52h20v38M30 90V30h24v60M58 90V62h16v28M78 90V20h26v70M108 90V48h8v42" />
          <path d="M35 38h14M35 46h14M35 54h14M35 62h14M35 70h14M83 28h16M83 36h16M83 44h16M83 52h16M83 60h16M83 68h16M10 60h12M10 68h12" />
        </g>
      </svg>
    </div>
  );
}
