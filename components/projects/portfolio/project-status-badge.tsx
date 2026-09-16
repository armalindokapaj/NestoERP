import type { ProjectStatus } from "@prisma/client";

import { cn } from "@/lib/utils/cn";

const LABELS: Record<ProjectStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  FINISHED: "Finished",
  ARCHIVED: "Archived",
};

const DOTS: Record<ProjectStatus, string> = {
  PENDING: "bg-warning",
  ACTIVE: "bg-success",
  FINISHED: "bg-info",
  ARCHIVED: "bg-fg-subtle",
};

/**
 * A project's status, legible on top of a render (E-05A §7, §10, §47).
 *
 * A solid pill rather than a tinted one, because it sits on an image whose
 * colours nobody controls. The dot reinforces the word and never replaces it —
 * status is not carried by colour alone.
 */
export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-fg shadow-card backdrop-blur-sm",
        className,
      )}
      data-testid="project-status"
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOTS[status])} />
      {LABELS[status]}
    </span>
  );
}
