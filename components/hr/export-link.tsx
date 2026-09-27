"use client";

import { ExportControl } from "@/lib/core/export/export-control";
import { useHrTranslations } from "./hr-text";

/**
 * Exports the list as it is currently filtered (PRD #16 §146, §147; AUD-08 §7).
 *
 * Every matching record in the standard columns, not the page on screen. The
 * endpoint re-runs the list service, which re-runs the scope.
 */
export function HrExportLink({
  type,
  label,
}: {
  type: "employees" | "leave" | "attendance";
  label?: string;
}) {
  const t = useHrTranslations();
  return <ExportControl endpoint="/api/hr/export" selector={{ param: "type", value: type }} label={label ?? t("common.exportCsv")} testId={`hr-export-${type}`} />;
}
