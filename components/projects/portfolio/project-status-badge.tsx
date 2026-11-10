"use client";

import type { ProjectStatus } from "@prisma/client";

import { useTranslations } from "@/components/i18n/i18n-provider";

import { cn } from "@/lib/utils/cn";

/** The legend's marks: built solid, under construction hatched, pending an outline, archived dashed. */
const MARKS: Record<ProjectStatus, string> = { PENDING: "outline", ACTIVE: "hatch", FINISHED: "solid", ARCHIVED: "dashed" };

/**
 * A project's status, legible on top of a render (E-05A §7, §10, §47).
 *
 * A solid pill rather than a tinted one, because it sits on an image whose
 * colours nobody controls. The legend mark before the word says the status
 * in shape as well as colour.
 */
export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const t = useTranslations("projects");
  return (
    <span
      className={cn(
        // Mono capitals with the status mark before them. On a render, the card makes it the reference's dark glass chip.
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-2 py-0.5 font-mono text-[0.625rem] leading-(--nesto-leading-micro) font-medium uppercase tracking-[0.1em] text-fg backdrop-blur-sm",
        className,
      )}
      data-testid="project-status"
      data-mark={MARKS[status]}
    >
      {t(`status.${status}`)}
    </span>
  );
}
