"use client";

import { ExportControl } from "@/lib/core/export/export-control";

/**
 * CSV export (PRD #18 §225, §226; AUD-08 §7, DT-02).
 *
 * Every contract the list's current filters match, in the standard columns,
 * with its redaction (PRD #18 §227). The section the reader is on —
 * `/contracts/active`, `/contracts/archived`… — is part of the list's query
 * even though it is in the path rather than the address's query, so it is sent
 * as `view` (an explicit `?view=` wins, as it does on the list). The list's
 * contract-type filter is `type`, which the export uses to pick the file, so it
 * travels as `contractType`.
 */
/**
 * The list's sections that are pages of their own (`CONTRACT_VIEWS`, kept here
 * so the schema's server-side helpers stay out of the browser bundle; the
 * export refuses a view it does not know, and a unit test keeps the two equal).
 */
export const CONTRACT_SECTION_VIEWS = ["all", "drafts", "review", "active", "expiring", "expired", "terminated", "archived"] as const;

export function contractSectionOf(pathname: string): string | null {
  const [module, segment] = pathname.split("/").filter(Boolean);
  return module === "contracts" && segment && (CONTRACT_SECTION_VIEWS as readonly string[]).includes(segment) ? segment : null;
}

export function ContractExportLink({
  type = "contracts",
  label = "Export CSV",
}: {
  type?: "contracts" | "obligations" | "amendments";
  search?: string;
  label?: string;
}) {
  return (
    <ExportControl
      endpoint="/api/contracts/export"
      selector={{ param: "type", value: type }}
      label={label}
      testId={`contracts-export-${type}`}
      adjust={(params, pathname) => {
        if (type !== "contracts") return;
        const contractType = params.get("type");
        if (contractType) params.set("contractType", contractType);
        params.delete("type");
        const section = contractSectionOf(pathname);
        if (section && !params.get("view")) params.set("view", section);
      }}
    />
  );
}
