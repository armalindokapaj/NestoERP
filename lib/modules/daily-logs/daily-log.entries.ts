import { Prisma } from "@prisma/client";
import type { z } from "zod";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildTaskScopeWhere } from "@/lib/access/scope";
import { buildReceiptScopeWhere as buildInventoryReceiptScopeWhere } from "@/lib/modules/inventory/inventory.scope";
import { buildOrderScopeWhere, buildReceiptScopeWhere as buildGoodsReceiptScopeWhere } from "@/lib/modules/procurement/procurement.scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { canEditSection, MODULE, RECORD } from "./daily-log.permissions";
import type { SECTION_SCHEMAS } from "./daily-log.schema";
import { ACTIVITY_ENTITY, fail, findReadableLog, lockedError, touchLog, type ReadableLog } from "./daily-log.service";
import { resolveDailyLogSettings } from "./daily-log.settings";
import { dateOf, timeOn } from "./daily-log.time";
import type { SectionKey } from "./daily-log.types";

/**
 * The sections of a log, one row at a time (PRD #43 §21-§61, §159-§161,
 * §184-§192).
 *
 * Every write re-reads the log in the reader's scope, checks the section's own
 * grant and that the log is still being written, validates every id it names
 * against this company — a supplier, an order, a receipt, a task, a member —
 * and bumps the log's version inside the same transaction. An entry edited in
 * two windows is a conflict, not a silent overwrite. Nothing here receives
 * goods, posts stock, completes a task or raises a claim.
 */

type Tx = Prisma.TransactionClient;
type SectionInput<K extends SectionKey> = z.infer<(typeof SECTION_SCHEMAS)[K]>;

const MAJOR_DELAY_IMPACTS = new Set(["HIGH", "CRITICAL"]);

async function assertSupplier(context: UserContext, supplierId: string | null) {
  if (!supplierId) return;
  const found = await prisma.supplier.count({ where: { id: supplierId, companyId: context.companyId } });
  if (!found) throw fail("DAILY_LOG_SUPPLIER_INVALID", "That supplier is not one of your company's.", "VALIDATION_ERROR", { field: "supplierId" });
}

async function assertMember(context: UserContext, memberId: string | null, field: string) {
  if (!memberId) return;
  const found = await prisma.companyMember.count({ where: { id: memberId, companyId: context.companyId, status: "ACTIVE" } });
  if (!found) throw fail("DAILY_LOG_MEMBER_INVALID", "Choose an active member of your company.", "VALIDATION_ERROR", { field });
}

/** One of the company's crews, on this log's project or on none (E-04 §43). */
async function assertCrew(context: UserContext, log: ReadableLog, crewId: string | null) {
  if (!crewId) return;
  const found = await prisma.workforceCrew.count({ where: { id: crewId, companyId: context.companyId, OR: [{ projectId: log.projectId }, { projectId: null }] } });
  if (!found) throw fail("DAILY_LOG_CREW_INVALID", "Choose one of this project's crews.", "VALIDATION_ERROR", { field: "crewId" });
}

/** A task on this log's project that the writer can open (§38, §191). */
export async function assertTask(context: UserContext, log: ReadableLog, taskId: string | null) {
  if (!taskId) return;
  const task =
    canAccessModule(context, "tasks") && can(context, "task.view")
      ? await prisma.task.findFirst({ where: { AND: [buildTaskScopeWhere(context), { id: taskId }] }, select: { id: true, projectId: true, archivedAt: true } })
      : null;
  if (!task) throw fail("DAILY_LOG_TASK_INVALID", "You cannot link that task.", "VALIDATION_ERROR", { field: "linkedTaskId" });
  if (task.projectId !== log.projectId) throw fail("DAILY_LOG_TASK_PROJECT_MISMATCH", "That task belongs to another project.", "VALIDATION_ERROR", { field: "linkedTaskId" });
}

/**
 * A contractor assigned to this log's project and a work package on it
 * (PRD #46 §140-§143). There is no separate contractor diary: the crew and the
 * work sit in the same log. A terminated assignment still records the days it
 * was on site.
 */
async function contractorContext(context: UserContext, log: ReadableLog, input: { contractorId: string | null; workPackageId: string | null }) {
  if (!input.contractorId && !input.workPackageId) return { contractorId: null, workPackageId: null };
  const { resolveProjectContext } = await import("@/lib/modules/engineering/engineering.shared");
  return resolveProjectContext(context, log.projectId, input, { newWork: false });
}

type DeliveryLinks = { purchaseOrderId: string | null; goodsReceiptId: string | null; inventoryReceiptId: string | null };

/**
 * Procurement and inventory documents of this company, on this project where
 * they name one (§47, §48, §116, §117, §191).
 *
 * Each is read inside the writer's own procurement or inventory door — module,
 * view grant and scope, the same test the form's options pass (PRD #47 §50,
 * §62) — so a purchase order id typed by somebody who cannot open purchase
 * orders is refused like one that does not exist, and a delivery never tells
 * its writer which orders exist or which project they are for. A link the
 * entry already carries is kept without being re-read: somebody editing the
 * delivery's description does not lose the order a buyer attached.
 */
async function assertDeliveryLinks(context: UserContext, log: ReadableLog, input: SectionInput<"deliveries">, kept: DeliveryLinks | null = null) {
  await assertSupplier(context, input.supplierId);
  const procurementOpen = canAccessModule(context, "procurement");
  let orderSupplier: string | null = null;
  if (input.purchaseOrderId && input.purchaseOrderId !== kept?.purchaseOrderId) {
    const order = procurementOpen && can(context, "procurement.order.view")
      ? await prisma.purchaseOrder.findFirst({ where: { AND: [buildOrderScopeWhere(context), { id: input.purchaseOrderId, companyId: context.companyId }] }, select: { projectId: true, supplierId: true } })
      : null;
    if (!order) throw fail("DAILY_LOG_PURCHASE_ORDER_INVALID", "Choose a purchase order you have access to.", "VALIDATION_ERROR", { field: "purchaseOrderId" }, "SCOPE_DENIED");
    if (order.projectId && order.projectId !== log.projectId) throw fail("DAILY_LOG_PURCHASE_ORDER_PROJECT_MISMATCH", "That purchase order is for another project.", "VALIDATION_ERROR", { field: "purchaseOrderId" }, "CROSS_PROJECT_REFERENCE");
    orderSupplier = order.supplierId;
  } else if (input.purchaseOrderId) {
    orderSupplier = (await prisma.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, companyId: context.companyId }, select: { supplierId: true } }))?.supplierId ?? null;
  }
  if (input.goodsReceiptId && (input.goodsReceiptId !== kept?.goodsReceiptId || input.purchaseOrderId !== kept?.purchaseOrderId)) {
    const receipt = procurementOpen && can(context, "procurement.receipt.view")
      ? await prisma.goodsReceipt.findFirst({ where: { AND: [buildGoodsReceiptScopeWhere(context), { id: input.goodsReceiptId, companyId: context.companyId }] }, select: { purchaseOrderId: true, projectId: true } })
      : null;
    if (!receipt) throw fail("DAILY_LOG_GOODS_RECEIPT_INVALID", "Choose a goods receipt you have access to.", "VALIDATION_ERROR", { field: "goodsReceiptId" }, "SCOPE_DENIED");
    if (input.purchaseOrderId && receipt.purchaseOrderId !== input.purchaseOrderId) throw fail("DAILY_LOG_GOODS_RECEIPT_ORDER_MISMATCH", "That goods receipt belongs to another purchase order.", "VALIDATION_ERROR", { field: "goodsReceiptId" });
    if (receipt.projectId && receipt.projectId !== log.projectId) throw fail("DAILY_LOG_GOODS_RECEIPT_PROJECT_MISMATCH", "That goods receipt is for another project.", "VALIDATION_ERROR", { field: "goodsReceiptId" }, "CROSS_PROJECT_REFERENCE");
  }
  if (input.inventoryReceiptId && input.inventoryReceiptId !== kept?.inventoryReceiptId) {
    const stock = canAccessModule(context, "inventory") && can(context, "inventory.receipt.view")
      ? await prisma.inventoryReceipt.count({ where: { AND: [buildInventoryReceiptScopeWhere(context), { id: input.inventoryReceiptId, companyId: context.companyId }] } })
      : 0;
    if (!stock) throw fail("DAILY_LOG_INVENTORY_RECEIPT_INVALID", "Choose an inventory receipt you have access to.", "VALIDATION_ERROR", { field: "inventoryReceiptId" }, "SCOPE_DENIED");
  }
  if (orderSupplier && input.supplierId && orderSupplier !== input.supplierId) {
    throw fail("DAILY_LOG_SUPPLIER_ORDER_MISMATCH", "The supplier differs from the purchase order's.", "VALIDATION_ERROR", { field: "supplierId" });
  }
  return orderSupplier;
}

/** What a section's input becomes on its row; ids already validated. */
async function toData(context: UserContext, log: ReadableLog, section: SectionKey, input: SectionInput<SectionKey>, zone: string, kept: DeliveryLinks | null = null): Promise<Record<string, unknown>> {
  const workDate = dateOf(log.workDate);
  switch (section) {
    case "weather": {
      const value = input as SectionInput<"weather">;
      return {
        observedAt: timeOn(workDate, value.observedTime, zone),
        temperatureC: value.temperatureC === null ? null : new Prisma.Decimal(value.temperatureC),
        condition: value.condition,
        precipitationMm: value.precipitationMm === null ? null : new Prisma.Decimal(value.precipitationMm),
        windKph: value.windKph === null ? null : new Prisma.Decimal(value.windKph),
        humidityPct: value.humidityPct,
        notes: value.notes,
      };
    }
    case "workforce": {
      const value = input as SectionInput<"workforce">;
      await assertSupplier(context, value.supplierId);
      await assertCrew(context, log, value.crewId);
      const scope = await contractorContext(context, log, value);
      return { organizationName: value.organizationName, supplierId: value.supplierId, ...scope, trade: value.trade, crewName: value.crewName, crewId: value.crewId, headcount: value.headcount, notes: value.notes };
    }
    case "activities": {
      const value = input as SectionInput<"activities">;
      await assertTask(context, log, value.linkedTaskId);
      const scope = await contractorContext(context, log, value);
      return {
        title: value.title, description: value.description, projectArea: value.projectArea, floorZone: value.floorZone, trade: value.trade,
        progressPercent: value.progressPercent === null ? null : new Prisma.Decimal(value.progressPercent), linkedTaskId: value.linkedTaskId, ...scope,
      };
    }
    case "equipment": {
      const value = input as SectionInput<"equipment">;
      await assertSupplier(context, value.supplierId);
      return { equipmentName: value.equipmentName, equipmentCode: value.equipmentCode, supplierId: value.supplierId, quantity: value.quantity, hoursUsed: value.hoursUsed === null ? null : new Prisma.Decimal(value.hoursUsed), status: value.status, notes: value.notes };
    }
    case "deliveries": {
      const value = input as SectionInput<"deliveries">;
      const orderSupplier = await assertDeliveryLinks(context, log, value, kept);
      const date = value.deliveredDate ?? (value.deliveredTime ? workDate : null);
      return {
        description: value.description, supplierId: value.supplierId ?? orderSupplier, purchaseOrderId: value.purchaseOrderId, goodsReceiptId: value.goodsReceiptId, inventoryReceiptId: value.inventoryReceiptId,
        quantityText: value.quantityText, deliveredAt: date ? timeOn(date, value.deliveredTime ?? "12:00", zone) : null, conditionNote: value.conditionNote, notes: value.notes,
      };
    }
    case "visitors": {
      const value = input as SectionInput<"visitors">;
      await assertMember(context, value.escortedByMemberId, "escortedByMemberId");
      return { name: value.name, organization: value.organization, purpose: value.purpose, arrivedAt: timeOn(workDate, value.arrivedTime, zone), departedAt: timeOn(workDate, value.departedTime, zone), escortedByMemberId: value.escortedByMemberId, notes: value.notes };
    }
    case "delays": {
      const value = input as SectionInput<"delays">;
      await assertTask(context, log, value.linkedTaskId);
      // With both times given the duration is theirs, never a conflicting typed value (§188).
      const derived = value.startedTime && value.endedTime ? minutesBetween(value.startedTime, value.endedTime) : value.durationMinutes;
      return {
        category: value.category, title: value.title, description: value.description, startedAt: timeOn(workDate, value.startedTime, zone), endedAt: timeOn(workDate, value.endedTime, zone),
        durationMinutes: derived, responsiblePartyText: value.responsiblePartyText, impact: value.impact, linkedTaskId: value.linkedTaskId,
      };
    }
    case "instructions": {
      const value = input as SectionInput<"instructions">;
      await assertMember(context, value.issuedByMemberId, "issuedByMemberId");
      await assertTask(context, log, value.linkedTaskId);
      return {
        title: value.title, description: value.description, issuedByText: value.issuedByText, issuedByMemberId: value.issuedByMemberId, recipientText: value.recipientText,
        issuedAt: timeOn(workDate, value.issuedTime, zone), requiresAction: value.requiresAction, linkedTaskId: value.linkedTaskId,
      };
    }
  }
}

export function minutesBetween(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return th * 60 + tm - (fh * 60 + fm);
}

type Delegate = {
  create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
  findFirst(args: { where: { id: string; dailyLogId: string }; select: { id: true; updatedAt: true } }): Promise<{ id: string; updatedAt: Date } | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

function delegate(tx: Tx, section: SectionKey): Delegate {
  const models: Record<SectionKey, unknown> = {
    weather: tx.dailyLogWeatherEntry,
    workforce: tx.dailyLogWorkforceEntry,
    activities: tx.dailyLogWorkActivity,
    equipment: tx.dailyLogEquipmentEntry,
    deliveries: tx.dailyLogDeliveryEntry,
    visitors: tx.dailyLogVisitorEntry,
    delays: tx.dailyLogDelayEntry,
    instructions: tx.dailyLogInstructionEntry,
  };
  return models[section] as Delegate;
}

/** The log, when this reader may write this section of it now. */
export async function prepare(context: UserContext, dailyLogId: string, section: SectionKey) {
  const log = await findReadableLog(context, dailyLogId);
  if (!canEditSection(context, log.status, section)) {
    if (log.status !== "DRAFT" && log.status !== "CORRECTION_REQUIRED") throw lockedError(log.status);
    throw new AccessError("FORBIDDEN", "You cannot change this part of the log.", { code: "DAILY_LOG_SECTION_FORBIDDEN" });
  }
  const settings = await resolveDailyLogSettings(context.companyId, log.projectId);
  return { log, zone: settings.timezone };
}

export async function addEntry<K extends SectionKey>(context: UserContext, dailyLogId: string, section: K, input: SectionInput<K>): Promise<{ id: string; version: number }> {
  const { log, zone } = await prepare(context, dailyLogId, section);
  const data = await toData(context, log, section, input, zone);
  return prisma.$transaction(async (tx) => {
    const version = await touchLog(tx, log.id);
    const row = await delegate(tx, section).create({
      data: { ...data, companyId: context.companyId, dailyLogId: log.id, ...(section === "activities" ? { createdByMemberId: context.membershipId } : {}) },
      select: { id: true },
    });
    if (section === "delays") {
      const value = data as { category: string; impact: string | null; durationMinutes: number | null; title: string };
      await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_DELAY_ADDED, entity: { type: RECORD, id: log.id }, after: { entryId: row.id, category: value.category, impact: value.impact, durationMinutes: value.durationMinutes } }, { tx });
      if (value.impact && MAJOR_DELAY_IMPACTS.has(value.impact)) {
        await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_MAJOR_DELAY", message: `recorded a ${value.impact.toLowerCase()}-impact delay`, metadata: { note: value.title } as Prisma.InputJsonValue });
      }
    }
    if (section === "instructions") {
      await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_INSTRUCTION_ADDED, entity: { type: RECORD, id: log.id }, after: { entryId: row.id, requiresAction: (data as { requiresAction: boolean }).requiresAction } }, { tx });
    }
    return { id: row.id, version };
  });
}

export async function updateEntry<K extends SectionKey>(context: UserContext, dailyLogId: string, section: K, entryId: string, input: SectionInput<K> & { updatedAt?: string }): Promise<{ id: string; version: number }> {
  const { log, zone } = await prepare(context, dailyLogId, section);
  const kept = section === "deliveries" ? await prisma.dailyLogDeliveryEntry.findFirst({ where: { id: entryId, dailyLogId: log.id }, select: { purchaseOrderId: true, goodsReceiptId: true, inventoryReceiptId: true } }) : null;
  const data = await toData(context, log, section, input, zone, kept);
  return prisma.$transaction(async (tx) => {
    const current = await delegate(tx, section).findFirst({ where: { id: entryId, dailyLogId: log.id }, select: { id: true, updatedAt: true } });
    if (!current) throw fail("DAILY_LOG_ENTRY_NOT_FOUND", "That entry could not be found.", "NOT_FOUND");
    if (input.updatedAt && new Date(input.updatedAt).getTime() !== current.updatedAt.getTime()) {
      throw fail("DAILY_LOG_ENTRY_CHANGED", "Someone changed this entry since you opened it. Reload to see the latest.", "CONFLICT");
    }
    const version = await touchLog(tx, log.id);
    await delegate(tx, section).update({ where: { id: current.id }, data });
    return { id: current.id, version };
  });
}

export async function removeEntry(context: UserContext, dailyLogId: string, section: SectionKey, entryId: string): Promise<{ version: number }> {
  const { log } = await prepare(context, dailyLogId, section);
  return prisma.$transaction(async (tx) => {
    const current = await delegate(tx, section).findFirst({ where: { id: entryId, dailyLogId: log.id }, select: { id: true, updatedAt: true } });
    if (!current) throw fail("DAILY_LOG_ENTRY_NOT_FOUND", "That entry could not be found.", "NOT_FOUND");
    const version = await touchLog(tx, log.id);
    await delegate(tx, section).delete({ where: { id: current.id } });
    return { version };
  });
}
