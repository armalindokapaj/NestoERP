"use client";

import { ExportControl } from "@/lib/core/export/export-control";
import { useQaqcTranslations } from "./qaqc-text";
import type { QaqcExportType } from "@/lib/modules/qaqc/qaqc.export";

/**
 * CSV export (PRD #21 §201, §202; AUD-08 §7).
 *
 * Every row the list's current filters match — same scope, same view, same
 * order — read from the page's own address when clicked. There is no separate
 * "export everything" door. `search` is accepted for the pages that still pass
 * it; the address in the browser is the one source of truth.
 */
export function QaqcExportLink({
  type,
  label,
}: {
  type: QaqcExportType;
  search?: string;
  label?: string;
}) {
  const t = useQaqcTranslations();
  return <ExportControl endpoint="/api/qaqc/export" selector={{ param: "kind", value: type }} label={label ?? t("common.exportCsv")} testId={`qaqc-export-${type}`} />;
}
