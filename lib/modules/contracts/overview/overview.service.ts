import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { canSeeCommercial, currencyTotals } from "../contract.dto";
import { buildContractScopeWhere } from "../contract.scope";
import type { ContractAttentionListDTO, ContractOverviewDTO } from "../contract.types";
import * as contracts from "../contracts/contract.service";
import * as obligations from "../obligations/obligation.service";
import { isRenewalNoticeDue } from "../contracts/contract.status";

/**
 * The Legal overview (PRD #18 §32–§34, §339).
 *
 * Every number is a database aggregate over the caller's own scope, so a
 * project manager's "active contracts" counts the agreements on their projects
 * and a company total is never leaked as a headline figure (PRD #18 §34, §300).
 *
 * Value is grouped by currency and omitted entirely without commercial
 * permission — not shown as a blank card, which would tell the reader there is
 * a figure they are not being shown (PRD #18 §298, §495).
 */

const DAY = 24 * 60 * 60 * 1000;

export async function contractOverview(context: UserContext): Promise<ContractOverviewDTO> {
  assertModule(context, "contracts");
  assertPermission(context, "legal.view");

  const today = new Date();
  const visible = {
    contracts: can(context, "legal.contract.view"),
    approvals: can(context, "legal.approval.view"),
    obligations: can(context, "legal.obligation.view"),
    commercial: canSeeCommercial(context),
  };

  if (!visible.contracts) {
    return {
      visible,
      activeContracts: 0,
      expiringIn30Days: 0,
      expiringIn90Days: 0,
      pendingReview: 0,
      pendingApproval: 0,
      approvedNotSent: 0,
      sentNotSigned: 0,
      readyToActivate: 0,
      openObligations: 0,
      overdueObligations: 0,
      renewalNoticeDue: 0,
      terminatedThisYear: 0,
      activeValue: null,
    };
  }

  const scope = buildContractScopeWhere(context);
  const live = { AND: [scope, { archivedAt: null }] } satisfies Prisma.ContractWhereInput;
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));

  const [
    activeContracts,
    expiringIn30Days,
    expiringIn90Days,
    pendingReview,
    pendingApproval,
    approvedNotSent,
    sentNotSigned,
    readyToActivate,
    terminatedThisYear,
    openObligations,
    overdueObligations,
    renewalCandidates,
    activeRows,
  ] = await Promise.all([
    prisma.contract.count({ where: { AND: [live, { status: "ACTIVE" }] } }),
    countExpiring(live, today, 30),
    countExpiring(live, today, 90),
    prisma.contract.count({ where: { AND: [live, { status: "IN_REVIEW" }] } }),
    prisma.contract.count({ where: { AND: [live, { status: "PENDING_APPROVAL" }] } }),
    prisma.contract.count({ where: { AND: [live, { status: "APPROVED" }] } }),
    prisma.contract.count({ where: { AND: [live, { status: "SENT" }] } }),
    prisma.contract.count({
      where: { AND: [live, { status: "SIGNED", effectiveDate: { not: null, lte: today } }] },
    }),
    prisma.contract.count({
      where: { AND: [scope, { status: "TERMINATED", terminationDate: { gte: yearStart } }] },
    }),
    visible.obligations
      ? prisma.contractObligation.count({ where: { contract: { is: scope }, status: "OPEN" } })
      : 0,
    visible.obligations
      ? prisma.contractObligation.count({
          where: { contract: { is: scope }, status: "OPEN", dueDate: { lt: today } },
        })
      : 0,
    prisma.contract.findMany({
      where: {
        AND: [live, { status: "ACTIVE", renewalType: { not: "NONE" }, expiryDate: { not: null } }],
      },
      select: { status: true, expiryDate: true, renewalType: true, renewalNoticeDays: true },
    }),
    visible.commercial
      ? prisma.contract.findMany({
          where: { AND: [live, { status: "ACTIVE", currency: { not: null } }] },
          select: { currency: true, contractValue: true },
        })
      : [],
  ]);

  return {
    visible,
    activeContracts,
    expiringIn30Days,
    expiringIn90Days,
    pendingReview,
    pendingApproval,
    approvedNotSent,
    sentNotSigned,
    readyToActivate,
    openObligations,
    overdueObligations,
    // Filtered in memory because the alert date is expiry minus notice days, a
    // per-row subtraction rather than a column (PRD #18 §74, §517).
    renewalNoticeDue: renewalCandidates.filter((row) => isRenewalNoticeDue(row, today)).length,
    terminatedThisYear,
    // Only ACTIVE, for a metric whose meaning is unambiguous (PRD #18 §514).
    activeValue: visible.commercial ? currencyTotals(activeRows) : null,
  };
}

function countExpiring(
  live: Prisma.ContractWhereInput,
  today: Date,
  days: number,
): Promise<number> {
  return prisma.contract.count({
    where: {
      AND: [
        live,
        {
          status: "ACTIVE",
          expiryDate: { gte: today, lte: new Date(today.getTime() + days * DAY) },
        },
      ],
    },
  });
}

/**
 * What needs somebody's attention (PRD #18 §339).
 *
 * Each list is short and scoped, and each entry is a record the reader can open
 * — an attention list that names something unreachable is a leak with a helpful
 * label on it.
 */
export async function contractAttention(
  context: UserContext,
): Promise<ContractAttentionListDTO> {
  assertModule(context, "contracts");
  assertPermission(context, "legal.contract.view");

  const [expiring, awaitingSignature, signed, renewalNoticeDue, inactiveOwners, overdue] =
    await Promise.all([
      contracts.listContracts(context, listQuery({ view: "expiring", limit: 5 })),
      contracts.listContracts(context, listQuery({ status: ["SENT"], limit: 5 })),
      contracts.listContracts(context, listQuery({ status: ["SIGNED"], limit: 10 })),
      /*
       * Asked of the database rather than filtered out of a page. These two
       * used to be derived from the first 50 active contracts sorted by expiry,
       * which quietly hid every inactive owner on a contract expiring later.
       */
      contracts.listRenewalNoticeDue(context, 5),
      contracts.listInactiveOwnerContracts(context, 5),
    can(context, "legal.obligation.view")
      ? obligations.listObligations(context, {
          overdueOnly: true,
          page: 1,
          limit: 5,
          status: undefined,
          obligationType: undefined,
          responsibleMemberId: undefined,
          contractId: undefined,
        })
      : { data: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 1 } },
  ]);

  return {
    expiring: expiring.data,
    renewalNoticeDue,
    // Signed contracts are few and already fully fetched, so filtering the
    // page here is the whole set rather than a slice of it.
    readyToActivate: signed.data.filter((row) => row.attention.readyToActivate).slice(0, 5),
    awaitingSignature: awaitingSignature.data,
    overdueObligations: overdue.data,
    inactiveOwners,
  };
}

type ListQueryShape = Parameters<typeof contracts.listContracts>[1];

function listQuery(overrides: Partial<ListQueryShape>): ListQueryShape {
  return {
    view: "all",
    mine: false,
    page: 1,
    limit: 5,
    sort: "expiry-asc",
    ...overrides,
  } as ListQueryShape;
}
