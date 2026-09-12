import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { canSeeCommercial, canSeeConfidential } from "./contract.dto";
import { contractStatusLabels } from "./contracts/contract.status";
import { contractTypeLabels } from "./contracts/contract.schema";
import * as contracts from "./contracts/contract.service";
import * as obligations from "./obligations/obligation.service";
import * as amendments from "./amendments/amendment.service";
import { obligationStatusLabels, obligationTypeLabels } from "./obligations/obligation.status";
import { amendmentStatusLabels } from "./amendments/amendment.status";
import type { ContractListQuery } from "./contracts/contract.schema";
import type { ObligationListQuery } from "./obligations/obligation.schema";

/**
 * CSV export (PRD #18 §225–§228).
 *
 * The export is the list. It parses the same query, calls the same service and
 * receives the same redacted DTOs — so a reader without commercial permission
 * gets a file with no value column rather than a file with the values in it
 * (PRD #18 §226, §227, §441).
 */

export const EXPORT_ROW_CAP = 10_000;

export type ContractExportType = "contracts" | "obligations" | "amendments";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function exportContracts(
  context: UserContext,
  type: ContractExportType,
  query: ContractListQuery,
  obligationQuery: ObligationListQuery,
): Promise<{ filename: string; csv: string }> {
  assertModule(context, "contracts");
  assertPermission(context, "legal.export");

  const commercial = canSeeCommercial(context);

  if (type === "obligations") {
    const result = await obligations.listObligations(context, {
      ...obligationQuery,
      limit: Math.min(obligationQuery.limit, 100),
    });

    return {
      filename: "contract-obligations.csv",
      csv: toCsv(
        ["Obligation", "Type", "Responsible", "Due date", "Status", "Days overdue"],
        result.data.map((row) => [
          row.title,
          obligationTypeLabels[row.type],
          row.responsible?.fullName ?? "",
          row.dueDate,
          obligationStatusLabels[row.status],
          row.daysOverdue || "",
        ]),
      ),
    };
  }

  if (type === "amendments") {
    const rows = await amendments.listAllAmendments(context);
    return {
      filename: "contract-amendments.csv",
      csv: toCsv(
        commercial
          ? ["Contract", "Amendment", "Title", "Status", "Effective", "New value", "New expiry"]
          : ["Contract", "Amendment", "Title", "Status", "Effective", "New expiry"],
        rows.map((row) => {
          const base = [
            row.contract.contractNumber,
            row.amendmentNumber,
            row.title,
            amendmentStatusLabels[row.status],
            row.effectiveDate ? row.effectiveDate.toISOString().slice(0, 10) : "",
          ];
          const expiry = row.newExpiryDate ? row.newExpiryDate.toISOString().slice(0, 10) : "";
          return commercial
            ? [...base, row.newContractValue ? row.newContractValue.toString() : "", expiry]
            : [...base, expiry];
        }),
      ),
    };
  }

  const result = await contracts.listContracts(context, {
    ...query,
    page: 1,
    limit: 100,
  });

  const headers = [
    "Contract number",
    "Title",
    "Type",
    "Client",
    "Counterparty",
    "Project",
    "Owner",
    "Status",
    "Effective",
    "Expiry",
    "Renewal",
  ];

  // The commercial columns are absent, not blank: a header with nothing under
  // it still tells the reader a figure exists (PRD #18 §227, §495).
  if (commercial) headers.push("Currency", "Value");

  return {
    filename: "contracts.csv",
    csv: toCsv(
      headers,
      result.data.map((row) => {
        const base: (string | number | null)[] = [
          row.contractNumber,
          row.title,
          contractTypeLabels[row.contractType],
          row.client?.name ?? "",
          row.counterpartyName ?? "",
          row.project ? `${row.project.code} — ${row.project.name}` : "",
          row.owner.fullName,
          contractStatusLabels[row.status],
          row.effectiveDate,
          row.expiryDate,
          row.renewalType,
        ];
        if (commercial) {
          base.push(row.commercial?.currency ?? "", row.commercial?.contractValue ?? "");
        }
        return base;
      }),
    ),
  };
}

/** Whether the confidential columns would be redacted, for the UI hint. */
export function exportRedactsConfidential(context: UserContext): boolean {
  return !canSeeConfidential(context);
}
