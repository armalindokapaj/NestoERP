import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { exportDate, prepareExport, type ExportColumn, type ExportLimits, type PreparedExport } from "@/lib/core/export/exporter";
import { assertExportParams, assertExportRange, type ParamRules } from "@/lib/core/export/export-params";
import { canSeeCommercial, canSeeConfidential } from "./contract.dto";
import { parseContractQuery, parseObligationQuery } from "./contract.query";
import type { ContractObligationDTO, ContractSummaryDTO } from "./contract.types";
import { amendmentStatusLabels } from "./amendments/amendment.status";
import * as amendments from "./amendments/amendment.service";
import { CONTRACT_SORT_KEYS, CONTRACT_TYPES, CONTRACT_VIEWS, RENEWAL_TYPES, contractTypeLabels, type ContractListQuery } from "./contracts/contract.schema";
import * as contracts from "./contracts/contract.service";
import { CONTRACT_STATUSES, contractStatusLabels, renewalTypeLabels } from "./contracts/contract.status";
import { OBLIGATION_STATUSES, obligationStatusLabels, obligationTypeLabels } from "./obligations/obligation.status";
import type { ObligationListQuery } from "./obligations/obligation.schema";
import * as obligations from "./obligations/obligation.service";

/**
 * CSV export (PRD #18 §225–§228; AUD-08 §7).
 *
 * The export is the list. It parses the same query — including the section
 * the reader is on (`view`: drafts, active, expiring, archived…), which the
 * export control sends from the page's address — calls the same service and
 * receives the same redacted DTOs, so a reader without commercial permission
 * gets a file with no value column rather than a file with the values in it
 * (PRD #18 §226, §227, §441). Every match leaves, not the first page: the
 * limit is the row cap, and past it the request is refused whole (DT-17).
 *
 * `type` picks the file (contracts, obligations, amendments). It is therefore
 * not available as the obligation-type filter here; an obligation export takes
 * `status`, `responsible`, `contractId` and `overdue`. Amendments take no
 * filters: every amendment of a contract the reader may see.
 *
 * Cells go through the shared CSV writer, so a contract title or counterparty
 * typed as a formula stays text in the spreadsheet (PRD #47 §69).
 *
 * Limits: 10,000 rows, 10 MiB, 30 s (the declared `EXPORT_ROW_CAP`).
 */

export const EXPORT_ROW_CAP = 10_000;
export const CONTRACT_EXPORT_LIMITS: Partial<ExportLimits> = { maxRows: EXPORT_ROW_CAP };

export const EXPORT_TYPES = ["contracts", "obligations", "amendments"] as const;
export type ContractExportType = (typeof EXPORT_TYPES)[number];

export const CONTRACT_EXPORT_PARAMS: Record<ContractExportType, ParamRules> = {
  contracts: {
    search: { kind: "text" },
    view: { kind: "enum", allowed: CONTRACT_VIEWS },
    status: { kind: "enumList", allowed: CONTRACT_STATUSES, caseInsensitive: true },
    renewal: { kind: "enumList", allowed: RENEWAL_TYPES, caseInsensitive: true },
    clientId: { kind: "id" },
    projectId: { kind: "id" },
    owner: { kind: "id" },
    currency: { kind: "text", max: 8 },
    effectiveFrom: { kind: "date" },
    effectiveTo: { kind: "date" },
    expiryFrom: { kind: "date" },
    expiryTo: { kind: "date" },
    within: { kind: "int", min: 1, max: 365 },
    mine: { kind: "flag" },
    sort: { kind: "enum", allowed: CONTRACT_SORT_KEYS },
  },
  obligations: {
    status: { kind: "enumList", allowed: OBLIGATION_STATUSES, caseInsensitive: true },
    responsible: { kind: "id" },
    contractId: { kind: "id" },
    overdue: { kind: "flag" },
  },
  amendments: {},
};

/** The contract-type filter shares its name with the export selector, so it is read as `contractType` here. */
const CONTRACT_TYPE_PARAM: ParamRules = { contractType: { kind: "enumList", allowed: CONTRACT_TYPES, caseInsensitive: true } };

export function contractColumns(context: UserContext): ExportColumn<ContractSummaryDTO>[] {
  const columns: ExportColumn<ContractSummaryDTO>[] = [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Contract ID", kind: "code", value: (row) => row.id },
    { header: "Contract number", kind: "code", value: (row) => row.contractNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Type", kind: "status", value: (row) => contractTypeLabels[row.contractType] },
    { header: "Client ID", kind: "code", value: (row) => row.client?.id },
    { header: "Client", kind: "text", value: (row) => row.client?.name },
    { header: "Counterparty", kind: "text", value: (row) => row.counterpartyName },
    { header: "Project ID", kind: "code", value: (row) => row.project?.id },
    { header: "Project code", kind: "code", value: (row) => row.project?.code },
    { header: "Project", kind: "text", value: (row) => row.project?.name },
    { header: "Owner", kind: "text", value: (row) => row.owner.fullName },
    { header: "Status", kind: "status", value: (row) => contractStatusLabels[row.status] },
    { header: "Effective status", kind: "status", value: (row) => contractStatusLabels[row.attention.effectiveStatus] },
    { header: "Effective", kind: "date", value: (row) => row.effectiveDate },
    { header: "Expiry", kind: "date", value: (row) => row.expiryDate },
    { header: "Renewal", kind: "status", value: (row) => renewalTypeLabels[row.renewalType] },
  ];
  // The commercial columns are absent, not blank: a header with nothing under
  // it still tells the reader a figure exists (PRD #18 §227, §495).
  if (canSeeCommercial(context)) {
    columns.push(
      { header: "Currency", kind: "code", value: (row) => row.commercial?.currency },
      { header: "Value", kind: "decimal", value: (row) => row.commercial?.contractValue },
    );
  }
  return columns;
}

export function obligationColumns(context: UserContext): ExportColumn<ContractObligationDTO>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Obligation ID", kind: "code", value: (row) => row.id },
    { header: "Contract ID", kind: "code", value: (row) => row.contractId },
    { header: "Obligation", kind: "text", value: (row) => row.title },
    { header: "Type", kind: "status", value: (row) => obligationTypeLabels[row.type] },
    { header: "Responsible", kind: "text", value: (row) => row.responsible?.fullName },
    { header: "Due date", kind: "date", value: (row) => row.dueDate },
    { header: "Status", kind: "status", value: (row) => obligationStatusLabels[row.status] },
    { header: "Days overdue", kind: "integer", value: (row) => row.daysOverdue || null },
  ];
}

type AmendmentRow = Awaited<ReturnType<typeof amendments.listAllAmendments>>[number];

export function amendmentColumns(context: UserContext): ExportColumn<AmendmentRow>[] {
  const columns: ExportColumn<AmendmentRow>[] = [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Amendment ID", kind: "code", value: (row) => row.id },
    { header: "Contract ID", kind: "code", value: (row) => row.contract.id },
    { header: "Contract", kind: "code", value: (row) => row.contract.contractNumber },
    { header: "Amendment", kind: "code", value: (row) => row.amendmentNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Status", kind: "status", value: (row) => amendmentStatusLabels[row.status] },
    { header: "Effective", kind: "date", value: (row) => exportDate(row.effectiveDate) },
  ];
  if (canSeeCommercial(context)) {
    columns.push(
      { header: "Currency", kind: "code", value: (row) => row.contract.currency },
      { header: "New value", kind: "decimal", value: (row) => (row.newContractValue ? row.newContractValue.toFixed(2) : null) },
    );
  }
  columns.push({ header: "New expiry", kind: "date", value: (row) => exportDate(row.newExpiryDate) });
  return columns;
}

/**
 * The export's query string → the list's own queries, refusing a filter the
 * list would drop (DT-03). The list's `type` filter travels as `contractType`,
 * since `type` picks the file.
 */
export function parseContractExport(
  context: UserContext,
  type: ContractExportType,
  params: URLSearchParams,
): { query: ContractListQuery; obligationQuery: ObligationListQuery } {
  assertModule(context, "contracts");
  assertPermission(context, "legal.export");
  const rules = type === "contracts" ? { ...CONTRACT_EXPORT_PARAMS.contracts, ...CONTRACT_TYPE_PARAM } : CONTRACT_EXPORT_PARAMS[type];
  assertExportParams(params, rules, { selector: ["type"] });
  assertExportRange(params, "effectiveFrom", "effectiveTo");
  assertExportRange(params, "expiryFrom", "expiryTo");
  const listParams = new URLSearchParams(params);
  listParams.delete("type");
  const contractType = params.get("contractType");
  if (contractType) listParams.set("type", contractType);
  return { query: parseContractQuery(listParams), obligationQuery: parseObligationQuery(listParams) };
}

export async function exportContracts(
  context: UserContext,
  type: ContractExportType,
  query: ContractListQuery,
  obligationQuery: ObligationListQuery,
  options: { evaluatedAt?: Date } = {},
): Promise<PreparedExport> {
  assertModule(context, "contracts");
  assertPermission(context, "legal.export");
  const shared = { limits: CONTRACT_EXPORT_LIMITS, evaluatedAt: options.evaluatedAt };

  if (type === "obligations") {
    return prepareExport({
      ...shared,
      id: "contracts.obligations",
      filename: "contract-obligations.csv",
      columns: obligationColumns(context),
      read: async (take) => {
        const result = await obligations.listObligations(context, { ...obligationQuery, page: 1, limit: take });
        return { rows: result.data, total: result.pagination.total };
      },
    });
  }

  if (type === "amendments") {
    return prepareExport({
      ...shared,
      id: "contracts.amendments",
      filename: "contract-amendments.csv",
      columns: amendmentColumns(context),
      // The service reads every amendment in scope; past the cap it is refused whole.
      read: async () => ({ rows: await amendments.listAllAmendments(context) }),
    });
  }

  return prepareExport({
    ...shared,
    id: "contracts.contracts",
    filename: "contracts.csv",
    columns: contractColumns(context),
    read: async (take) => {
      const result = await contracts.listContracts(context, { ...query, page: 1, limit: take });
      return { rows: result.data, total: result.pagination.total };
    },
  });
}

/** Whether the confidential columns would be redacted, for the UI hint. */
export function exportRedactsConfidential(context: UserContext): boolean {
  return !canSeeConfidential(context);
}
