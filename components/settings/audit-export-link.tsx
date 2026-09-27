"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { ExportControl } from "@/lib/core/export/export-control";

/**
 * Exports the audit log as it is currently filtered (PRD #28 §170-§174; AUD-08 §7).
 *
 * Every event the page's filters match, not the page on screen. Nothing here
 * decides what may leave: the endpoint re-checks `audit.export`, re-applies
 * company scope and redaction, and records the export as an audited event in
 * its own right.
 */
export function AuditExportLink() {
  const t = useTranslations("settings");
  return <ExportControl endpoint="/api/audit/export" label={t("audit.exportCsv")} testId="audit-export" />;
}
