/**
 * What every part of the showcase fill shares: dates counted from the reset,
 * a seeded random source (the same demo after every reset), who plays which
 * part in each company, and record numbers in each company's own format.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { memberId } from "../../demo/users";

export const DAY = 86_400_000;
export const EUR = "EUR";

export type Clock = { now: Date };

/** A moment `offset` days from the reset (negative: in the past). */
export const at = (clock: Clock, offset: number, hour = 10) => {
  const date = new Date(clock.now.getTime() + offset * DAY);
  date.setUTCHours(hour, (Math.abs(offset * 37) % 4) * 15, 0, 0);
  return date;
};

/** A business date at midday UTC, as finance and contracts store them. */
export const businessDay = (clock: Clock, offset: number) => {
  const date = new Date(clock.now.getTime() + offset * DAY);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
};

export const dec = (value: number | string) => new Prisma.Decimal(typeof value === "number" ? value.toFixed(2) : value);
export const round2 = (value: number) => Math.round(value * 100) / 100;
/** Rounded to a price a person would write: the nearest 500. */
export const priceOf = (value: number) => Math.round(value / 500) * 500;

/* -------------------------------------------------------------------------- */
/* Seeded random                                                               */
/* -------------------------------------------------------------------------- */

export type Random = {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
};

/** A random source that gives the same sequence for the same key, every reset. */
export function random(key: string): Random {
  let state = 2166136261;
  for (const char of key) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (probability) => next() < probability,
  };
}

/* -------------------------------------------------------------------------- */
/* Who plays which part                                                        */
/* -------------------------------------------------------------------------- */

export type Part = "owner" | "ceo" | "pm" | "architect" | "engineer" | "sales" | "salesHead" | "finance" | "financeHead" | "legal" | "procurement" | "inventory" | "hse" | "qaqc" | "hr";

/** The group's heads: members of every company. */
const GROUP: Record<Part, string> = {
  owner: "user_owner",
  ceo: "user_owner",
  pm: "user_owner",
  architect: "user_architecture_manager",
  engineer: "user_group_engineering",
  sales: "user_sales_manager",
  salesHead: "user_sales_manager",
  finance: "user_finance",
  financeHead: "user_finance",
  legal: "user_legal",
  procurement: "user_procurement",
  inventory: "user_inventory",
  hse: "user_hse",
  qaqc: "user_qaqc",
  hr: "user_hr",
};

/** Each company's own people, where it has one for the part. */
const OWN: Record<string, Partial<Record<Part, string>>> = {
  company_demo_a: { ceo: "user_ceo", pm: "user_pm", architect: "user_architect", engineer: "user_engineer", sales: "user_sales", finance: "user_finance_a" },
  company_demo_b: { ceo: "user_ceo_b", pm: "user_pm_b", architect: "user_architecture_manager_b", finance: "user_finance_b", qaqc: "user_qaqc_b" },
  company_demo_c: { ceo: "user_ceo_c", pm: "user_pm_c", engineer: "user_engineer_c", finance: "user_finance_c", hse: "user_hse_c" },
  company_demo_d: { ceo: "user_ceo_d", pm: "user_pm_d", architect: "user_architect_d", finance: "user_finance_manager_d", qaqc: "user_qaqc_d" },
  company_demo_e: { ceo: "user_ceo_e", pm: "user_pm_e", legal: "user_legal_manager_e", sales: "user_sales_e", hse: "user_hse_e" },
};

export type Cast = {
  companyId: string;
  /** The person's user id. */
  user(part: Part): string;
  /** Their membership in this company. */
  member(part: Part): string;
  name(part: Part): string;
};

export async function castOf(prisma: PrismaClient, companyId: string): Promise<Cast> {
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } });
  const names = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`]));
  const user = (part: Part) => OWN[companyId]?.[part] ?? GROUP[part];
  return { companyId, user, member: (part) => memberId(user(part), companyId), name: (part) => names.get(user(part)) ?? part };
}

/* -------------------------------------------------------------------------- */
/* Record numbers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Numbers in the format the app itself hands out (`PO-2026-0007`), carrying on
 * from the highest one each company already has, so a record a prospect
 * creates next never collides (`syncNumbering` moves the counters after).
 */
export class Numbers {
  private readonly next = new Map<string, number>();

  constructor(private readonly prisma: PrismaClient) {}

  async take(input: { companyId: string; table: string; column: string; prefix: string; year: number; padding?: number }): Promise<string> {
    const stem = `${input.prefix}-${input.year}-`;
    const key = `${input.companyId}|${input.table}|${stem}`;
    if (!this.next.has(key)) this.next.set(key, (await highest(this.prisma, input.table, input.column, input.companyId, stem)) + 1);
    const sequence = this.next.get(key)!;
    this.next.set(key, sequence + 1);
    return `${stem}${String(sequence).padStart(input.padding ?? 4, "0")}`;
  }
}

async function highest(prisma: PrismaClient, table: string, column: string, companyId: string, stem: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
    `select max(substring("${column}" from '([0-9]+)$')::int) as max from "${table}" where "companyId" = $1 and "${column}" like $2 and "${column}" ~ '[0-9]+$'`,
    companyId,
    `${stem}%`,
  );
  return Number(rows[0]?.max ?? 0);
}

/** Where each numbering scheme's numbers live, to move its counter past them. */
const NUMBERED: Record<string, { table: string; column: string }> = {
  "sales/proposal": { table: "proposals", column: "proposalNumber" },
  "finance/invoice": { table: "invoices", column: "invoiceNumber" },
  "finance/expense": { table: "expenses", column: "expenseNumber" },
  "contracts/contract": { table: "contracts", column: "contractNumber" },
  "procurement/purchase_request": { table: "purchase_requests", column: "requestNumber" },
  "procurement/rfq": { table: "rfqs", column: "rfqNumber" },
  "procurement/purchase_order": { table: "purchase_orders", column: "poNumber" },
  "procurement/goods_receipt": { table: "goods_receipts", column: "receiptNumber" },
  "inventory/stock_issue": { table: "stock_issues", column: "issueNumber" },
  "qaqc/inspection": { table: "quality_inspections", column: "inspectionNumber" },
  "qaqc/ncr": { table: "non_conformance_reports", column: "ncrNumber" },
  "qaqc/corrective_action": { table: "corrective_actions", column: "actionNumber" },
  "hse/hazard": { table: "hse_hazards", column: "hazardNumber" },
  "hse/incident": { table: "hse_incidents", column: "incidentNumber" },
  "hse/permit": { table: "hse_work_permits", column: "permitNumber" },
  "hse/action": { table: "hse_actions", column: "actionNumber" },
  "contractors/work_package": { table: "work_packages", column: "code" },
  "engineering/rfi": { table: "rfis", column: "rfiNumber" },
  "engineering/technical_submittal": { table: "technical_submittals", column: "submittalNumber" },
  "engineering/transmittal": { table: "document_transmittals", column: "transmittalNumber" },
};

/**
 * Moves every numbering counter past the highest number of this year already
 * in its format, so the next number the app hands out is free.
 */
export async function syncNumbering(prisma: PrismaClient, clock: Clock): Promise<number> {
  const year = clock.now.getUTCFullYear();
  const schemes = await prisma.companyNumberingScheme.findMany();
  let moved = 0;
  for (const scheme of schemes) {
    const place = NUMBERED[`${scheme.moduleKey}/${scheme.entityType}`];
    if (!place || !scheme.prefix || scheme.yearMode !== "YYYY") continue;
    const top = await highest(prisma, place.table, place.column, scheme.companyId, `${scheme.prefix}${scheme.separator}${year}${scheme.separator}`);
    if (top + 1 <= scheme.nextSequence && scheme.currentYear === year) continue;
    await prisma.companyNumberingScheme.update({ where: { id: scheme.id }, data: { nextSequence: Math.max(top + 1, scheme.currentYear === year ? scheme.nextSequence : 1), currentYear: year } });
    moved += 1;
  }
  return moved;
}

/* -------------------------------------------------------------------------- */
/* Trail                                                                       */
/* -------------------------------------------------------------------------- */

/** An entry in the activity feed, as the service that made the change writes it. */
export async function trail(prisma: PrismaClient, input: { companyId: string; module: string; entityType: string; entityId: string; action: string; message: string; memberId: string; userId: string; when: Date; projectId?: string }) {
  await prisma.activity.create({
    data: {
      companyId: input.companyId,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      message: input.message,
      actorMemberId: input.memberId,
      actorUserId: input.userId,
      metadata: input.projectId ? { projectId: input.projectId } : undefined,
      createdAt: input.when,
    },
  });
}
