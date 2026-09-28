import type { AuditCategory, AuditSeverity, Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";

/**
 * The platform Audit Log (Admin Audit PRD #6 §61-§73): who did what, to which
 * entity, when, and what changed. Server-side filters and pages over the
 * canonical audit trail; read-only — nothing here edits or deletes an event.
 * Snapshots are already redacted when written; no secret is ever stored.
 */

function assertAudit(context: PlatformContext) {
  if (!canPlatform(context, "platform.audit.view")) throw new AccessError("FORBIDDEN");
}

export const AUDIT_PAGE_SIZE = 50;
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
export const auditFilterSchema = z.object({
  q: z.string().trim().max(120).catch(""),
  actor: z.string().trim().max(120).catch(""),
  action: z.string().trim().max(120).catch(""),
  entity: z.string().trim().max(80).catch(""),
  org: z.string().trim().max(128).catch(""),
  category: z.string().trim().max(40).catch(""),
  severity: z.enum(["", "INFO", "IMPORTANT", "CRITICAL"]).catch(""),
  from: day.or(z.literal("")).catch(""),
  to: day.or(z.literal("")).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

function whereOf(filter: AuditFilter): Prisma.AuditEventWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const and: Prisma.AuditEventWhereInput[] = [];
  if (filter.q) and.push({ OR: [{ entityLabelSnapshot: contains(filter.q) }, { actorDisplayNameSnapshot: contains(filter.q) }, { actionKey: contains(filter.q.replaceAll(" ", "_")) }, { reason: contains(filter.q) }, { company: { name: contains(filter.q) } }] });
  if (filter.actor) and.push({ actorDisplayNameSnapshot: contains(filter.actor) });
  if (filter.action) and.push({ actionKey: contains(filter.action.replaceAll(" ", "_")) });
  if (filter.entity) and.push({ entityType: filter.entity });
  if (filter.org) and.push({ OR: [{ parentGroupId: filter.org }, { companyId: filter.org }, { company: { parentGroupId: filter.org } }] });
  if (filter.category) and.push({ category: filter.category as AuditCategory });
  if (filter.severity) and.push({ severity: filter.severity as AuditSeverity });
  if (filter.from) and.push({ occurredAt: { gte: new Date(`${filter.from}T00:00:00Z`) } });
  if (filter.to) and.push({ occurredAt: { lt: new Date(new Date(`${filter.to}T00:00:00Z`).getTime() + 86_400_000) } });
  return and.length ? { AND: and } : {};
}

const ROW = {
  id: true, occurredAt: true, actionKey: true, category: true, severity: true, moduleKey: true,
  actorDisplayNameSnapshot: true, actorRoleSnapshot: true, entityType: true, entityId: true, entityLabelSnapshot: true, reason: true,
  company: { select: { id: true, name: true } }, parentGroup: { select: { id: true, name: true, kind: true } },
} satisfies Prisma.AuditEventSelect;

/** "PLATFORM_MODULE_ENTITLEMENT_CHANGED" → "Module entitlement changed". */
export function auditActionLabel(actionKey: string): string {
  const text = actionKey.replace(/^PLATFORM_/, "").toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function present(row: Prisma.AuditEventGetPayload<{ select: typeof ROW }>) {
  return {
    id: row.id, occurredAt: row.occurredAt.toISOString(), action: auditActionLabel(row.actionKey), actionKey: row.actionKey,
    category: row.category, severity: row.severity, actor: row.actorDisplayNameSnapshot ?? "System", actorRole: row.actorRoleSnapshot,
    entityType: row.entityType, entityId: row.entityId, entity: row.entityLabelSnapshot ?? row.entityType ?? "—",
    organization: row.company?.name ?? (row.parentGroup ? (row.parentGroup.kind === "GROUP" ? row.parentGroup.name : "Standalone company") : "Platform"),
    reason: row.reason,
  };
}

export async function listAuditLog(context: PlatformContext, raw: Record<string, unknown>) {
  assertAudit(context);
  const filter = auditFilterSchema.parse(raw);
  const where = whereOf(filter);
  const [total, rows] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (filter.page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE, select: ROW }),
  ]);
  return { filter, total, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)), rows: rows.map(present) };
}

/** Filter choices from the data itself, so nothing offered matches nothing. */
export async function auditFilterOptions(context: PlatformContext) {
  assertAudit(context);
  const [entities, categories, groups] = await Promise.all([
    prisma.auditEvent.findMany({ where: { entityType: { not: null } }, distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" }, take: 100 }),
    prisma.auditEvent.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.parentGroup.findMany({ where: { isTestFixture: false, kind: "GROUP" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    entities: entities.map((row) => row.entityType!).filter(Boolean),
    categories: categories.map((row) => row.category),
    organizations: groups.map((row) => ({ value: row.id, label: row.name })),
  };
}

/** One event with its before/after, as recorded (§66). */
export async function getAuditLogEvent(context: PlatformContext, eventId: string) {
  assertAudit(context);
  const row = assertFound(await prisma.auditEvent.findUnique({ where: { id: eventId }, select: { ...ROW, beforeJson: true, afterJson: true, changesJson: true, requestId: true, correlationId: true, ipAddress: true } }));
  return { ...present(row), before: row.beforeJson, after: row.afterJson, changes: row.changesJson, requestId: row.requestId, correlationId: row.correlationId, ipAddress: row.ipAddress };
}

const CSV_LIMIT = 5_000;
const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  // Quoted, and never read as a formula by a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** The filtered log as CSV, capped and stated as such (§73). */
export async function exportAuditLog(context: PlatformContext, raw: Record<string, unknown>): Promise<{ csv: string; truncated: boolean }> {
  assertAudit(context);
  const filter = auditFilterSchema.parse(raw);
  const where = whereOf(filter);
  const rows = await prisma.auditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: CSV_LIMIT + 1, select: ROW });
  const lines = [["Time (UTC)", "Actor", "Role", "Action", "Entity type", "Entity", "Organization", "Category", "Severity", "Reason"].map(cell).join(",")];
  for (const row of rows.slice(0, CSV_LIMIT).map(present)) {
    lines.push([row.occurredAt, row.actor, row.actorRole, row.action, row.entityType, row.entity, row.organization, row.category, row.severity, row.reason].map(cell).join(","));
  }
  return { csv: `${lines.join("\n")}\n`, truncated: rows.length > CSV_LIMIT };
}
