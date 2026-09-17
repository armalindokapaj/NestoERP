import { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { sqlTimestamp } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { loadStructureProject } from "@/lib/modules/project-structure/structure.service";
import { businessDateString } from "../finance.fields";
import { companyToday, financeCapabilities } from "./unit-finance.core";
import { UNIT_FINANCIAL_STATUSES, type FinanceInventoryDTO, type FinanceInventoryRowDTO, type UnitFinancialStatus } from "./unit-finance.types";
import type { FinanceInventoryQuery } from "./unit-finance.schema";

/**
 * A project's units as Finance sees them (E-05F §45-§48, §65, §92, §106-§108).
 *
 * A read model, not stored: each unit, its live contract, and the contract's
 * figures — paid, outstanding, overdue, next due, financial status — computed in
 * one SQL statement with the same rules `unit-finance.rules.ts` applies to a
 * single unit, so the list can be filtered, counted and sorted by them in the
 * database. A page of ids comes from that statement; the totals are summed once
 * per contract, never per unit, so a contract selling an apartment and its
 * parking is counted once (§92).
 *
 * Search reaches contract, invoice and payment numbers only for readers who may
 * see them, and a client's name only for readers who may open clients (§48, §103).
 */

function figures(companyId: string, projectId: string, today: Date): Prisma.Sql {
  return Prisma.sql`
    WITH live AS (
      SELECT cu."unitId", c."id" AS "contractId", c."contractNumber", c."status"::text AS "contractStatus", COALESCE(c."contractValue", 0) AS "value", c."currency", c."clientId"
      FROM "contract_units" cu
      JOIN "contracts" c ON c."id" = cu."contractId"
      WHERE cu."companyId" = ${companyId} AND cu."projectId" = ${projectId} AND cu."releasedAt" IS NULL
    ),
    paid AS (
      SELECT a."contractId", SUM(a."amount") AS "paid"
      FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."paymentId"
      WHERE a."companyId" = ${companyId} AND a."reversedAt" IS NULL AND p."status" = 'RECORDED' AND a."contractId" IN (SELECT "contractId" FROM live)
      GROUP BY a."contractId"
    ),
    received AS (
      SELECT p."contractId", SUM(p."amount") AS "received"
      FROM "payments" p
      WHERE p."companyId" = ${companyId} AND p."status" = 'RECORDED' AND p."contractId" IN (SELECT "contractId" FROM live)
      GROUP BY p."contractId"
    ),
    installments AS (
      SELECT i."contractId", i."id", i."amount", i."dueDate", COALESCE(SUM(a."amount") FILTER (WHERE a."reversedAt" IS NULL AND p."status" = 'RECORDED'), 0) AS "paid"
      FROM "payment_installments" i
      JOIN "payment_schedules" s ON s."id" = i."scheduleId" AND s."status" IN ('ACTIVE', 'COMPLETED')
      LEFT JOIN "payment_allocations" a ON a."installmentId" = i."id"
      LEFT JOIN "payments" p ON p."id" = a."paymentId"
      WHERE i."companyId" = ${companyId} AND i."contractId" IN (SELECT "contractId" FROM live)
      GROUP BY i."contractId", i."id", i."amount", i."dueDate"
    ),
    due AS (
      SELECT "contractId",
        SUM(GREATEST("amount" - "paid", 0)) FILTER (WHERE "dueDate" < ${sqlTimestamp(today)} AND "paid" < "amount") AS "overdue",
        SUM(GREATEST("amount" - "paid", 0)) AS "open",
        MIN("dueDate") FILTER (WHERE "paid" < "amount") AS "nextDueDate"
      FROM installments GROUP BY "contractId"
    ),
    next AS (
      SELECT DISTINCT ON (i."contractId") i."contractId", GREATEST(i."amount" - i."paid", 0) AS "nextDueAmount"
      FROM installments i WHERE i."paid" < i."amount"
      ORDER BY i."contractId", i."dueDate" ASC, i."id" ASC
    ),
    facts AS (
      SELECT l.*, COALESCE(pd."paid", 0) AS "paid", GREATEST(l."value" - COALESCE(pd."paid", 0), 0) AS "outstanding",
        COALESCE(d."overdue", 0) AS "overdue", COALESCE(d."open", 0) AS "open", d."nextDueDate", n."nextDueAmount",
        GREATEST(COALESCE(r."received", 0) - COALESCE(pd."paid", 0), 0) AS "unallocated"
      FROM live l
      LEFT JOIN paid pd ON pd."contractId" = l."contractId"
      LEFT JOIN received r ON r."contractId" = l."contractId"
      LEFT JOIN due d ON d."contractId" = l."contractId"
      LEFT JOIN next n ON n."contractId" = l."contractId"
    )`;
}

/** The unit's financial status in SQL, in the order `financialStatus()` decides it (§85). */
const STATUS = Prisma.sql`(CASE
  WHEN f."contractId" IS NULL THEN 'NO_CONTRACT'
  WHEN f."contractStatus" NOT IN ('SIGNED', 'ACTIVE', 'COMPLETED') THEN 'CONTRACT_PENDING'
  WHEN f."outstanding" <= 0 AND (f."unallocated" > 0 OR f."open" > 0) THEN 'PAID'
  WHEN f."outstanding" <= 0 THEN 'FINANCIALLY_COMPLETE'
  WHEN f."overdue" > 0 THEN 'OVERDUE'
  WHEN f."paid" <= 0 THEN 'PAYMENT_PENDING'
  ELSE 'PARTIALLY_PAID' END)`;

function orderBy(sort: FinanceInventoryQuery["sort"]): Prisma.Sql {
  const structure = Prisma.sql`b."sortOrder" ASC, fl."sortOrder" ASC, u."sortOrder" ASC, u."unitCodeKey" ASC, u."id" ASC`;
  switch (sort) {
    case "code":
      return Prisma.sql`u."unitCodeKey" ASC, u."id" ASC`;
    case "outstanding":
      return Prisma.sql`f."outstanding" ASC NULLS LAST, ${structure}`;
    case "-outstanding":
      return Prisma.sql`f."outstanding" DESC NULLS LAST, ${structure}`;
    case "overdue":
      return Prisma.sql`f."overdue" DESC NULLS LAST, ${structure}`;
    case "nextDue":
      return Prisma.sql`f."nextDueDate" ASC NULLS LAST, ${structure}`;
    case "value":
      return Prisma.sql`f."value" DESC NULLS LAST, ${structure}`;
    default:
      return structure;
  }
}

type Row = {
  id: string;
  unitCode: string;
  unitType: string;
  building: string;
  floor: string;
  contractId: string | null;
  contractNumber: string | null;
  contractStatus: string | null;
  currency: string | null;
  clientId: string | null;
  clientName: string | null;
  value: Prisma.Decimal | null;
  paid: Prisma.Decimal | null;
  outstanding: Prisma.Decimal | null;
  overdue: Prisma.Decimal | null;
  nextDueDate: Date | null;
  nextDueAmount: Prisma.Decimal | null;
  status: UnitFinancialStatus;
};

const text = (value: Prisma.Decimal | null) => (value === null ? null : new Prisma.Decimal(value).toFixed(2));

export async function listFinanceInventory(context: UserContext, projectId: string, query: FinanceInventoryQuery): Promise<FinanceInventoryDTO> {
  const project = await loadStructureProject(context, projectId);
  const caps = financeCapabilities(context);
  if (!caps.canView) throw new AccessError("FORBIDDEN", "You cannot see this project's unit finance.");
  const canSeeClients = canAccessModule(context, "clients") && can(context, "client.view");
  const today = await companyToday(context.companyId);

  const filters: Prisma.Sql[] = [Prisma.sql`u."companyId" = ${context.companyId}`, Prisma.sql`u."projectId" = ${project.id}`];
  if (query.buildingId) filters.push(Prisma.sql`fl."buildingId" = ${query.buildingId}`);
  if (query.floorId) filters.push(Prisma.sql`u."floorId" = ${query.floorId}`);
  if (query.unitTypeId) filters.push(Prisma.sql`u."unitTypeId" = ${query.unitTypeId}`);
  if (query.contractStatus) filters.push(Prisma.sql`f."contractStatus" = ${query.contractStatus}`);
  if (query.clientId && canSeeClients) filters.push(Prisma.sql`f."clientId" = ${query.clientId}`);
  if (query.currency) filters.push(Prisma.sql`f."currency" = ${query.currency}`);
  if (query.overdue) filters.push(Prisma.sql`f."overdue" > 0`);
  if (query.dueFrom) filters.push(Prisma.sql`f."nextDueDate" >= ${sqlTimestamp(query.dueFrom)}`);
  if (query.dueTo) filters.push(Prisma.sql`f."nextDueDate" <= ${sqlTimestamp(query.dueTo)}`);
  if (query.outstandingMin) filters.push(Prisma.sql`f."outstanding" >= ${new Prisma.Decimal(query.outstandingMin)}`);
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const matches = [Prisma.sql`u."unitCode" ILIKE ${like}`, Prisma.sql`u."name" ILIKE ${like}`];
    if (canSeeClients) matches.push(Prisma.sql`cl."name" ILIKE ${like}`);
    matches.push(Prisma.sql`f."contractNumber" ILIKE ${like}`);
    if (caps.canSeeInvoices) matches.push(Prisma.sql`EXISTS (SELECT 1 FROM "invoices" inv WHERE inv."contractId" = f."contractId" AND inv."invoiceNumber" ILIKE ${like})`);
    if (caps.canSeePayments) matches.push(Prisma.sql`EXISTS (SELECT 1 FROM "payments" pay WHERE pay."contractId" = f."contractId" AND pay."reference" ILIKE ${like})`);
    filters.push(Prisma.sql`(${Prisma.join(matches, " OR ")})`);
  }

  const from = Prisma.sql`FROM "project_units" u
    JOIN "project_floors" fl ON fl."id" = u."floorId"
    JOIN "project_buildings" b ON b."id" = fl."buildingId"
    JOIN "project_unit_types" t ON t."id" = u."unitTypeId"
    LEFT JOIN facts f ON f."unitId" = u."id"
    LEFT JOIN "clients" cl ON cl."id" = f."clientId"`;
  const where = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
  const statusFilter = query.financialStatus ? Prisma.sql`AND ${STATUS} = ${query.financialStatus}` : Prisma.empty;
  const cte = figures(context.companyId, project.id, today);

  const [rows, counts, totals] = await Promise.all([
    prisma.$queryRaw<Row[]>`${cte}
      SELECT u."id", u."unitCode", t."name" AS "unitType", b."name" AS "building", fl."name" AS "floor",
        f."contractId", f."contractNumber", f."contractStatus", f."currency", f."clientId", cl."name" AS "clientName",
        f."value", f."paid", f."outstanding", f."overdue", f."nextDueDate", f."nextDueAmount", ${STATUS} AS "status"
      ${from} ${where} ${statusFilter}
      ORDER BY ${orderBy(query.sort)} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    // The quick filters' counts ignore the status filter itself, so every chip says what it would show (§47).
    prisma.$queryRaw<Array<{ status: UnitFinancialStatus; count: bigint }>>`${cte} SELECT ${STATUS} AS "status", COUNT(*) AS "count" ${from} ${where} GROUP BY 1`,
    // Totals over the contracts behind the listed units, each contract once (§92).
    prisma.$queryRaw<Array<{ currency: string; contracted: Prisma.Decimal; collected: Prisma.Decimal; outstanding: Prisma.Decimal; overdue: Prisma.Decimal }>>`${cte}
      SELECT x."currency", SUM(x."value") AS "contracted", SUM(x."paid") AS "collected", SUM(x."outstanding") AS "outstanding", SUM(x."overdue") AS "overdue"
      FROM (SELECT DISTINCT f."contractId", f."currency", f."value", f."paid", f."outstanding", f."overdue" ${from} ${where} ${statusFilter} AND f."contractId" IS NOT NULL AND f."contractStatus" IN ('SIGNED', 'ACTIVE', 'COMPLETED')) x
      GROUP BY x."currency" ORDER BY x."currency"`,
  ]);

  const items = rows.map((row): FinanceInventoryRowDTO => ({
    id: row.id,
    unitCode: row.unitCode,
    unitType: row.unitType,
    building: row.building,
    floor: row.floor,
    client: canSeeClients && row.clientId && row.clientName ? { id: row.clientId, name: row.clientName } : null,
    contract: row.contractId ? { id: row.contractId, number: row.contractNumber!, status: row.contractStatus! } : null,
    currency: row.currency,
    contractValue: row.contractId ? text(row.value) : null,
    paidAmount: row.contractId ? text(row.paid) : null,
    outstandingAmount: row.contractId ? text(row.outstanding) : null,
    overdueAmount: row.contractId ? text(row.overdue) : null,
    nextDue: row.nextDueDate && row.nextDueAmount !== null ? { amount: text(row.nextDueAmount)!, dueDate: businessDateString(row.nextDueDate) } : null,
    financialStatus: row.status,
  }));

  const tally = Object.fromEntries(UNIT_FINANCIAL_STATUSES.map((status) => [status, 0])) as Record<UnitFinancialStatus, number>;
  for (const row of counts) tally[row.status] = Number(row.count);
  const all = Object.values(tally).reduce((sum, value) => sum + value, 0);
  return {
    items,
    page: query.page,
    pageSize: query.limit,
    total: query.financialStatus ? tally[query.financialStatus] : all,
    counts: { ...tally, ALL: all },
    totals: totals.map((row) => ({ currency: row.currency, contracted: text(row.contracted)!, collected: text(row.collected)!, outstanding: text(row.outstanding)!, overdue: text(row.overdue)! })),
    canSeeClients,
  };
}
