"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "@/components/i18n/i18n-provider";

import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/lib/i18n/translator";
import { type Readiness, type ReadinessItem, type UnitPublicationStatus } from "@/lib/modules/project-structure/unit-publishing.types";
import { cn } from "@/lib/utils/cn";

/**
 * Where a unit stands in publishing, in words beside every colour (E-05D §13,
 * §45). Publishing is never a sales status (§15), so it has its own badge
 * rather than the shared status vocabulary. Since units publish on create
 * (2026-11) a unit is Published or Archived; the other tones stay for any old
 * row that still holds a retired state.
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

/** A checklist line in the reader's words: the server sends English, the line's key and variant say which words. */
function readinessText(t: Translate<"projects">, item: ReadinessItem): { label: string; hint: string | null } {
  if (item.key === "primaryArea") {
    const variant = item.variant === "anyArea" || item.variant === "saleableOrGross" ? item.variant : "saleable";
    return { label: t(`readinessItems.primaryArea.${variant}`), hint: item.hint === null ? null : t(`readinessHints.primaryArea.${variant}`) };
  }
  const label = t(`readinessItems.${item.key}`);
  if (item.hint === null) return { label, hint: null };
  switch (item.key) {
    case "salesPlan":
      return { label, hint: t(item.variant === "checking" ? "readinessHints.salesPlanChecking" : "readinessHints.salesPlanMissing") };
    case "primaryImage":
      return { label, hint: t(item.variant === "checking" ? "readinessHints.primaryImageChecking" : "readinessHints.primaryImageMissing") };
    case "references":
      return { label, hint: t("readinessHints.references", { count: item.count ?? 1 }) };
    default:
      return { label, hint: t(`readinessHints.${item.key}`) };
  }
}

/**
 * How complete the unit's listing is (§45) — information for whoever prepares
 * it. Nothing here blocks anything: the unit is published whatever it says.
 */
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
      <p className="mt-1 text-meta text-fg-muted">{t("publishing.readinessNote")}</p>
      <ul className="mt-3 space-y-2">
        {readiness.items.map((item) => {
          const text = readinessText(t, item);
          return (
          <li key={item.key} className="flex items-start gap-2 text-table" data-ok={item.ok}>
            {item.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden="true" />
            ) : (
              <CircleAlert className={cn("mt-0.5 size-4 shrink-0", item.required ? "text-warning-strong" : "text-fg-subtle")} aria-hidden="true" />
            )}
            <span className="min-w-0">
              <span className={item.ok ? "text-fg" : "font-medium text-fg"}>{text.label}</span>
              {!item.required ? <span className="ml-1.5 text-meta text-fg-muted">{t("publishing.recommended")}</span> : null}
              <span className="sr-only">{item.ok ? t("publishing.complete") : t("publishing.missing")}</span>
              {text.hint ? <span className="block text-meta text-fg-muted">{text.hint}</span> : null}
            </span>
          </li>
          );
        })}
      </ul>
    </section>
  );
}
