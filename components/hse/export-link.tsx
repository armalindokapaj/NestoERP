"use client";

import { useHseTranslations } from "@/components/hse/hse-text";
import { ExportControl } from "@/lib/core/export/export-control";
import type { HseExportKind } from "@/lib/modules/hse/hse.export";

/**
 * CSV export (PRD #22 §216, §217; AUD-08 §7).
 *
 * Every row the list's current filters match — same scope, same view, same
 * order — read from the page's own address when clicked. There is no separate
 * "export everything" door. `search` is accepted for the pages that still pass
 * it; the address in the browser is the one source of truth.
 */
export function HseExportLink({
  kind,
  label,
}: {
  kind: HseExportKind;
  search?: string;
  label?: string;
}) {
  const t = useHseTranslations();
  return <ExportControl endpoint="/api/hse/export" selector={{ param: "kind", value: kind }} label={label ?? t("pages.exportCsv")} testId={`hse-export-${kind}`} />;
}
