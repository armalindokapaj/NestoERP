"use client";

import { ExportControl } from "@/lib/core/export/export-control";
import { useSalesTranslations } from "@/components/sales/sales-text";

/**
 * Exports the list as it is currently filtered (PRD #17 §170, §171; AUD-08 §7).
 *
 * Every matching record in the standard columns, not the page on screen: the
 * page's own filters, search, sort and section travel with the request, the
 * page number does not. Nothing here decides what may be exported — the
 * endpoint re-runs the list service, which re-runs the scope.
 */
export function SalesExportLink({
  type,
  label,
}: {
  type: "leads" | "opportunities" | "proposals";
  label?: string;
}) {
  const t = useSalesTranslations();
  return <ExportControl endpoint="/api/sales/export" selector={{ param: "type", value: type }} label={label ?? t("common.exportCsv")} testId={`sales-export-${type}`} />;
}
