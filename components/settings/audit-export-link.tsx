"use client";

import Link from "@/components/navigation/nav-link";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";

/**
 * Downloads the audit log as it is currently filtered (PRD #28 §170-§174).
 *
 * Carries the page's own search parameters so the file matches the screen.
 * Nothing here decides what may leave: the endpoint re-checks `audit.export`,
 * re-applies company scope and re-applies redaction, and records the export as
 * an audited event in its own right.
 */
export function AuditExportLink() {
  const searchParams = useSearchParams();
  const t = useTranslations("settings");

  const params = new URLSearchParams(searchParams.toString());
  params.delete("page");

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/api/audit/export?${params.toString()}`} prefetch={false} download>
        <Download aria-hidden="true" />
        {t("audit.exportCsv")}
      </Link>
    </Button>
  );
}
