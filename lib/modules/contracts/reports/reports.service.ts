import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import * as amendments from "../amendments/amendment.service";
import {
  canSeeCommercial,
  canSeeConfidential,
  currencyTotals,
  dateString,
  toMemberRef,
} from "../contract.dto";
import { buildContractScopeWhere } from "../contract.scope";
import type {
  AmendmentSummaryRow,
  ContractObligationDTO,
  ContractSummaryDTO,
  ExpiryBucketRow,
  OwnerSummaryRow,
  RenewalNoticeRow,
  StatusCountRow,
  TerminatedContractRow,
  TypeCountRow,
  ValueSummaryRow,
} from "../contract.types";
import * as contracts from "../contracts/contract.service";
import { CONTRACT_STATUSES } from "../contracts/contract.status";
import { renewalAlertDate } from "../contracts/contract.status";
import { CONTRACT_TYPES, contractTypeLabels } from "../contracts/contract.schema";
import * as obligations from "../obligations/obligation.service";
import { toAmountString } from "@/lib/modules/finance/finance.money";

/**
 * Legal reports (PRD #18 §216–§224, §299).
 *
 * Every report runs through the same scope clause and the same redaction as the
 * screens. A report is not a second, more generous view of the data — it is the
 * same data, grouped (PRD #18 §299, §446).
 */

const DAY = 24 * 60 * 60 * 1000;

export type ContractReports = {
  portfolio: ContractSummaryDTO[];
  byStatus: StatusCountRow[];
  byType: TypeCountRow[];
  expiring: ExpiryBucketRow[];
  renewals: RenewalNoticeRow[];
  value: ValueSummaryRow[] | null;
  byOwner: OwnerSummaryRow[];
  openObligations: ContractObligationDTO[];
  terminated: TerminatedContractRow[];
  amendments: AmendmentSummaryRow[];
};

export async function contractReports(context: UserContext): Promise<ContractReports> {
  assertModule(context, "contracts");
  assertPermission(context, "legal.report.view");

  const today = new Date();
  const scope = buildContractScopeWhere(context);
  const commercial = canSeeCommercial(context);

  const [portfolio, facts, owners, obligationRows, terminatedRows, amendmentRows] =
    await Promise.all([
      contracts.listContracts(context, {
        view: "all",
        mine: false,
        page: 1,
        limit: 100,
        sort: "expiry-asc",
      } as Parameters<typeof contracts.listContracts>[1]),
      prisma.contract.findMany({
        where: { AND: [scope, { archivedAt: null }] },
        select: {
          id: true,
          status: true,
          contractType: true,
          currency: true,
          contractValue: true,
          expiryDate: true,
          renewalType: true,
          renewalNoticeDays: true,
          ownerMemberId: true,
        },
      }),
      prisma.companyMember.findMany({
        where: { companyId: context.companyId, ownedContracts: { some: scope } },
        select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
      }),
      can(context, "legal.obligation.view")
        ? obligations.listObligations(context, {
            status: ["OPEN"],
            overdueOnly: false,
            page: 1,
            limit: 100,
            obligationType: undefined,
            responsibleMemberId: undefined,
            contractId: undefined,
          })
        : { data: [] as ContractObligationDTO[] },
      prisma.contract.findMany({
        where: { AND: [scope, { status: "TERMINATED" }] },
        orderBy: { terminationDate: "desc" },
        select: { id: true, terminationDate: true, terminationReason: true },
      }),
      can(context, "legal.amendment.view") ? amendments.listAllAmendments(context) : [],
    ]);

  const byId = new Map(portfolio.data.map((row) => [row.id, row]));

  return {
    portfolio: portfolio.data,
    byStatus: countBy(facts, "status", CONTRACT_STATUSES) as StatusCountRow[],
    byType: countBy(facts, "contractType", CONTRACT_TYPES) as TypeCountRow[],
    expiring: expiryBuckets(facts, today, commercial),
    renewals: renewalRows(facts, portfolio.data, today),
    value: commercial ? valueSummary(facts) : null,
    byOwner: ownerSummary(facts, owners, commercial),
    openObligations: obligationRows.data,
    terminated: terminatedRows.flatMap((row) => {
      const contract = byId.get(row.id);
      if (!contract) return [];
      return [
        {
          contract,
          terminationDate: dateString(row.terminationDate),
          // The reason is a confidential legal fact (PRD #18 §223, §228).
          terminationReason: canSeeConfidential(context) ? row.terminationReason : null,
        },
      ];
    }),
    amendments: amendmentRows.flatMap((row) => {
      const contract = byId.get(row.contractId);
      if (!contract) return [];
      return [
        {
          contractId: row.contractId,
          contractNumber: row.contract.contractNumber,
          amendmentNumber: row.amendmentNumber,
          title: row.title,
          status: row.status,
          effectiveDate: dateString(row.effectiveDate),
          valueChange: commercial
            ? {
                from:
                  row.previousContractValue === null
                    ? null
                    : toAmountString(row.previousContractValue),
                to: row.newContractValue === null ? null : toAmountString(row.newContractValue),
              }
            : null,
          expiryChange: {
            from: dateString(row.previousExpiryDate),
            to: dateString(row.newExpiryDate),
          },
        },
      ];
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                    */
/* -------------------------------------------------------------------------- */

type Fact = {
  id: string;
  status: string;
  contractType: string;
  currency: string | null;
  contractValue: Prisma.Decimal | null;
  expiryDate: Date | null;
  renewalType: string;
  renewalNoticeDays: number | null;
  ownerMemberId: string;
};

function countBy(rows: Fact[], key: "status" | "contractType", values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);

  return values
    .filter((value) => (counts.get(value) ?? 0) > 0)
    .map((value) => ({ [key]: value, count: counts.get(value) ?? 0 }));
}

/**
 * Expiry horizons (PRD #18 §219).
 *
 * Only ACTIVE contracts appear: a draft with a date in it has not started
 * running, so counting it as "expiring in 30 days" would be wrong twice.
 */
function expiryBuckets(rows: Fact[], today: Date, commercial: boolean): ExpiryBucketRow[] {
  const definitions = [
    { key: "0-30", label: "0–30 days", from: 0, to: 30 },
    { key: "31-60", label: "31–60 days", from: 31, to: 60 },
    { key: "61-90", label: "61–90 days", from: 61, to: 90 },
    { key: "91-180", label: "91–180 days", from: 91, to: 180 },
  ];

  return definitions.map((definition) => {
    const matching = rows.filter((row) => {
      if (row.status !== "ACTIVE" || !row.expiryDate) return false;
      const days = Math.round((row.expiryDate.getTime() - today.getTime()) / DAY);
      return days >= definition.from && days <= definition.to;
    });

    return {
      key: definition.key,
      label: definition.label,
      count: matching.length,
      totals: commercial ? currencyTotals(matching) : null,
    };
  });
}

function renewalRows(
  facts: Fact[],
  summaries: ContractSummaryDTO[],
  today: Date,
): RenewalNoticeRow[] {
  const byId = new Map(summaries.map((row) => [row.id, row]));

  return facts
    .filter((row) => row.status === "ACTIVE" && row.renewalType !== "NONE" && row.expiryDate)
    .flatMap((row) => {
      const contract = byId.get(row.id);
      if (!contract) return [];
      const alert = renewalAlertDate({
        status: "ACTIVE",
        expiryDate: row.expiryDate,
        renewalType: row.renewalType as never,
        renewalNoticeDays: row.renewalNoticeDays,
      });
      return [
        { contract, alertDate: dateString(alert), noticeDays: row.renewalNoticeDays },
      ];
    })
    .sort((a, b) => (a.alertDate ?? "").localeCompare(b.alertDate ?? ""))
    .filter((row) => row.alertDate !== null && new Date(row.alertDate!).getTime() <= today.getTime() + 365 * DAY);
}

/**
 * Value grouped by currency, and only within a status (PRD #18 §221, §513).
 *
 * A contract with no recorded value is excluded rather than counted as zero: a
 * portfolio total that quietly includes unpriced agreements understates itself.
 */
function valueSummary(rows: Fact[]): ValueSummaryRow[] {
  const priced = rows.filter((row) => row.contractValue !== null && row.currency);

  const byStatus = new Map<string, Fact[]>();
  for (const row of priced) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row);
    byStatus.set(row.status, list);
  }

  const statusRows = [...byStatus.entries()].map(([status, entries]) => ({
    key: `status:${status}`,
    label: status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " "),
    totals: currencyTotals(entries),
  }));

  const byType = new Map<string, Fact[]>();
  for (const row of priced) {
    const list = byType.get(row.contractType) ?? [];
    list.push(row);
    byType.set(row.contractType, list);
  }

  const typeRows = [...byType.entries()].map(([type, entries]) => ({
    key: `type:${type}`,
    label: contractTypeLabels[type as keyof typeof contractTypeLabels] ?? type,
    totals: currencyTotals(entries),
  }));

  return [...statusRows, ...typeRows];
}

function ownerSummary(
  rows: Fact[],
  owners: { id: string; status: string; user: { firstName: string; lastName: string } }[],
  commercial: boolean,
): OwnerSummaryRow[] {
  const byOwner = new Map<string, Fact[]>();
  for (const row of rows) {
    const list = byOwner.get(row.ownerMemberId) ?? [];
    list.push(row);
    byOwner.set(row.ownerMemberId, list);
  }

  return owners
    .flatMap((owner) => {
      const entries = byOwner.get(owner.id);
      if (!entries || entries.length === 0) return [];
      return [
        {
          owner: toMemberRef(owner as never)!,
          count: entries.length,
          totals: commercial ? currencyTotals(entries) : null,
        },
      ];
    })
    .sort((a, b) => b.count - a.count);
}
