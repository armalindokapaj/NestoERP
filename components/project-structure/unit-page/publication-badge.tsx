"use client";

import { CircleCheck, CircleX } from "lucide-react";
import { useTranslations } from "@/components/i18n/i18n-provider";

import { Badge } from "@/components/ui/badge";
import { type Readiness, type UnitPublicationStatus } from "@/lib/modules/project-structure/unit-publishing.types";
import { cn } from "@/lib/utils/cn";

/**
 * Where a unit stands in publishing, in words beside every colour (E-05D §13,
 * §28, §45). Publishing is never a sales status (§15), so it has its own badge
 * rather than the shared status vocabulary.
 */

const TONES: Record<UnitPublicationStatus, "default" | "info" | "success" | "warning" | "neutral"> = {
  DRAFT: "default",
  READY_FOR_PUBLISHING: "info",
  PUBLISHED: "success",
  REVISION_REQUIRED: "warning",
  ARCHIVED: "neutral",
};

export function PublicationBadge({ status, versionNumber, className }: { status: UnitPublicationStatus; versionNumber?: number | null; className?: string }) {
  const t = useTranslations("projects");
  return (
    <Badge tone={TONES[status]} className={className} data-testid="publication-status">
      {t(`publication.${status}`)}
      {status === "PUBLISHED" && versionNumber ? ` v${versionNumber}` : ""}
    </Badge>
  );
}

export function UnpublishedChangesBadge() {
  const t = useTranslations("projects");
  return (
    <Badge tone="warning" data-testid="unpublished-changes">
      {t("publishing.unpublishedChanges")}
    </Badge>
  );
}

/** The checklist a unit has to satisfy before it is submitted or published (§45). */
export function ReadinessPanel({ readiness, className }: { readiness: Readiness; className?: string }) {
  const t = useTranslations("projects");
  return (
    <section className={cn("nesto-card p-5", className)} aria-labelledby="unit-readiness" data-testid="readiness-panel">
      <h2 id="unit-readiness" className="text-card font-semibold text-fg">
        {t("publishing.readiness")}
      </h2>
      <p className={cn("mt-0.5 text-meta tabular-nums", readiness.ready ? "text-success-strong" : "text-fg-muted")}>
        {t("publishing.readinessCount", { complete: readiness.complete, required: readiness.required })}
      </p>
      <ul className="mt-3 space-y-2">
        {readiness.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-table" data-ok={item.ok}>
            {item.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden="true" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-danger-strong" aria-hidden="true" />}
            <span className="min-w-0">
              <span className={item.ok ? "text-fg" : "font-medium text-fg"}>{item.label}</span>
              <span className="sr-only">{item.ok ? t("publishing.complete") : t("publishing.missing")}</span>
              {item.hint ? <span className="block text-meta text-fg-muted">{item.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
