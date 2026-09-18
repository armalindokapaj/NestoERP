import { Prisma } from "@prisma/client";

import { AccessError, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { assertWorkforce } from "./workforce.permissions";
import type { CreateTradeInput, UpdateTradeInput } from "./workforce.schema";
import type { TradeDTO } from "./workforce.types";

/**
 * The company's trades (E-04 §11): mason, steel fixer, electrician. A trade is
 * a fact about the job, never a NESTO role (§13) — a worker without a login has
 * one. Each company keeps its own list, the way it keeps its project types.
 *
 * A trade anybody has been given is retired rather than deleted, so an
 * employee, a crew or an assignment never loses the trade it was recorded with.
 */

const PERMISSION = "workforce.trade.manage" as const;

const SELECT = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  sortOrder: true,
  _count: { select: { employees: true, crews: true, assignments: true } },
} satisfies Prisma.WorkforceTradeSelect;

type TradeRow = Prisma.WorkforceTradeGetPayload<{ select: typeof SELECT }>;

function toDTO(row: TradeRow): TradeDTO {
  return { id: row.id, name: row.name, code: row.code, isActive: row.isActive, sortOrder: row.sortOrder, employeeCount: row._count.employees, crewCount: row._count.crews };
}

function nameTaken(name: string): AccessError {
  const message = `There is already a trade called "${name}".`;
  return new AccessError("CONFLICT", message, { name: [message] });
}

/** "mason" and "Mason" are one trade. */
async function assertNameFree(companyId: string, name: string, exceptId?: string) {
  const clash = await prisma.workforceTrade.findFirst({
    where: { companyId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw nameTaken(name);
}

function translateWriteError(name: string | undefined) {
  return (error: unknown): never => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && name) throw nameTaken(name);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new AccessError("CONFLICT", "This trade is in use. Retire it instead.");
    throw error;
  };
}

export async function listTrades(context: UserContext): Promise<TradeDTO[]> {
  assertWorkforce(context, PERMISSION);
  const rows = await prisma.workforceTrade.findMany({ where: { companyId: context.companyId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: SELECT });
  return rows.map(toDTO);
}

/**
 * The trades a form may offer: those in use, plus the record's own trade when
 * it has since been retired, so saving other details never strips it.
 */
export async function tradeChoices(companyId: string, currentTradeId?: string | null): Promise<Array<{ value: string; label: string }>> {
  const rows = await prisma.workforceTrade.findMany({
    where: { companyId, OR: [{ isActive: true }, ...(currentTradeId ? [{ id: currentTradeId }] : [])] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });
  return rows.map((row) => ({ value: row.id, label: row.isActive ? row.name : `${row.name} (retired)` }));
}

export async function createTrade(context: UserContext, input: CreateTradeInput): Promise<TradeDTO> {
  assertWorkforce(context, PERMISSION);
  await assertNameFree(context.companyId, input.name);

  return prisma
    .$transaction(async (tx) => {
      const last = await tx.workforceTrade.aggregate({ where: { companyId: context.companyId }, _max: { sortOrder: true } });
      const row = await tx.workforceTrade.create({
        data: { companyId: context.companyId, name: input.name, code: input.code ?? null, sortOrder: (last._max.sortOrder ?? 0) + 1, createdByMemberId: context.membershipId },
        select: SELECT,
      });
      await recordUserAction(
        context,
        { actionKey: AuditAction.WORKFORCE_TRADE_CREATED, entity: { type: "WorkforceTrade", id: row.id, label: row.name }, after: { name: row.name, code: row.code, isActive: row.isActive } },
        { tx },
      );
      return toDTO(row);
    })
    .catch(translateWriteError(input.name));
}

export async function updateTrade(context: UserContext, tradeId: string, input: UpdateTradeInput): Promise<TradeDTO> {
  assertWorkforce(context, PERMISSION);
  const existing = await prisma.workforceTrade.findFirst({ where: { companyId: context.companyId, id: tradeId }, select: { id: true, name: true, code: true, isActive: true } });
  if (!existing) throw new AccessError("NOT_FOUND");

  const next = { name: input.name ?? existing.name, code: input.code === undefined ? existing.code : input.code, isActive: input.isActive ?? existing.isActive };
  if (next.name.toLowerCase() !== existing.name.toLowerCase()) await assertNameFree(context.companyId, next.name, tradeId);

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of ["name", "code", "isActive"] as const) {
    if (next[key] !== existing[key]) {
      before[key] = existing[key];
      after[key] = next[key];
    }
  }

  return prisma
    .$transaction(async (tx) => {
      const row = await tx.workforceTrade.update({ where: { companyId: context.companyId, id: tradeId }, data: { ...next, updatedByMemberId: context.membershipId }, select: SELECT });
      if (Object.keys(after).length > 0) {
        await recordUserAction(context, { actionKey: AuditAction.WORKFORCE_TRADE_UPDATED, entity: { type: "WorkforceTrade", id: row.id, label: row.name }, before, after }, { tx });
      }
      return toDTO(row);
    })
    .catch(translateWriteError(next.name));
}

/** The order every form shows the trades in. The request names every trade once; anything else is refused. */
export async function reorderTrades(context: UserContext, ids: string[]): Promise<TradeDTO[]> {
  assertWorkforce(context, PERMISSION);
  const rows = await prisma.workforceTrade.findMany({ where: { companyId: context.companyId }, select: { id: true, name: true, sortOrder: true } });
  const known = new Set(rows.map((row) => row.id));
  if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new AccessError("VALIDATION_ERROR", "The list has changed since it was loaded. Reload it and try again.");
  }
  const names = new Map(rows.map((row) => [row.id, row.name]));
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.workforceTrade.update({ where: { companyId: context.companyId, id }, data: { sortOrder: index + 1, updatedByMemberId: context.membershipId } });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.WORKFORCE_TRADES_REORDERED,
        entity: { type: "company", id: context.companyId, label: "Trades" },
        before: { order: [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.name) },
        after: { order: ids.map((id) => names.get(id)) },
      },
      { tx },
    );
  });
  return listTrades(context);
}

/** Only a trade nobody has ever been given. */
export async function deleteTrade(context: UserContext, tradeId: string): Promise<void> {
  assertWorkforce(context, PERMISSION);
  await prisma
    .$transaction(async (tx) => {
      const existing = await tx.workforceTrade.findFirst({ where: { companyId: context.companyId, id: tradeId }, select: SELECT });
      if (!existing) throw new AccessError("NOT_FOUND");
      const used = existing._count.employees + existing._count.crews + existing._count.assignments;
      if (used > 0) throw new AccessError("CONFLICT", "Employees, crews or assignments have this trade. Retire it instead.", { code: "TRADE_IN_USE" });
      await tx.workforceTrade.delete({ where: { companyId: context.companyId, id: tradeId } });
      await recordUserAction(
        context,
        { actionKey: AuditAction.WORKFORCE_TRADE_DELETED, entity: { type: "WorkforceTrade", id: existing.id, label: existing.name }, before: { name: existing.name, code: existing.code } },
        { tx },
      );
    })
    .catch(translateWriteError(undefined));
}

/** A trade a record may be given: one of this company's in use, or the one it already has. */
export async function requireTrade(tx: Prisma.TransactionClient, companyId: string, tradeId: string | null | undefined, current: string | null = null): Promise<string | null> {
  if (!tradeId) return null;
  if (tradeId === current) return tradeId;
  const row = await tx.workforceTrade.findFirst({ where: { id: tradeId, companyId, isActive: true }, select: { id: true } });
  if (!row) throw invalidRecordLink("tradeId", "CROSS_COMPANY_REFERENCE", "Choose one of this company's trades.");
  return row.id;
}
