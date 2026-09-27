"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { ExportControl } from "@/lib/core/export/export-control";
import type { FinanceExportEligibility } from "@/lib/modules/finance/finance.workspace";

/**
 * Export filtered CSV (AUD-01 §8, §9; AUD-08 §7).
 *
 * The shared Export control with the register's own wording: a fresh read of
 * every match of the register's current filters when clicked — not the page —
 * fetched rather than followed, so a refusal or a failure reads as a message
 * beside the button instead of replacing the page, and nothing is handed to the
 * browser unless a whole CSV arrived. The button stays focusable when it cannot
 * be used and says why; a second click while one export prepares does nothing.
 */
export function RegisterExportButton({
  endpoint,
  matchingCount,
  eligibility,
}: {
  endpoint: string;
  matchingCount: number;
  eligibility: FinanceExportEligibility;
}) {
  const t = useTranslations("financeRegister");

  if (eligibility.state === "unavailable") return null;

  const blocked =
    eligibility.state === "choose-company"
      ? t("exportChooseCompany", { companies: eligibility.companies.map((company) => company.name).join(", ") })
      : matchingCount === 0
        ? t("exportNothing")
        : null;

  return (
    <ExportControl
      endpoint={endpoint}
      label={t("exportCsv")}
      blocked={blocked}
      testId="register-export"
      readyLabel={(count) => t("exportDone", { count })}
      failedLabel={t("exportFailed")}
      retryLabel={t("exportRetry")}
      messageFor={(error) => {
        if (error.businessCode === "EXPORT_LIMIT_EXCEEDED") return t("exportTooMany");
        if (error.businessCode === "EXPORT_COMPANY_REQUIRED") return t("exportCompanyRequired");
        if (error.code === "FORBIDDEN" || error.code === "MODULE_UNAVAILABLE") return t("exportUnavailable");
        return t("exportFailed");
      }}
    />
  );
}
