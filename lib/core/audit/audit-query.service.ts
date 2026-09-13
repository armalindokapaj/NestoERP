import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { REDACTED } from "./audit-redaction";
import { AuditAction } from "./audit-policy.registry";
import { recordUserAction } from "./audit.service";

/**
 * Reading the audit log (PRD #28 §151-§168, §260-§261).
 *
 * Every read is company-scoped and re-checks permission, and sensitive values
 * are redacted a second time at read time: write-time redaction alone would not
 * protect an event written before a policy tightened (PRD #28 §157, §158).
 */

export const auditQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  actorMemberIds: z.array(z.string()).optional(),
  actorTypes: z.array(z.enum(["USER", "SYSTEM", "INTEGRATION"])).optional(),
  moduleKeys: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  actionKeys: z.array(z.string()).optional(),
  severities: z.array(z.enum(["INFO", "IMPORTANT", "CRITICAL"])).optional(),
  projectIds: z.array(z.string()).optional(),
  entityTypes: z.array(z.string()).optional(),
  query: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export type AuditEventListItemDTO = {
  id: string;
  occurredAt: string;
  actor: { type: string; memberId: string | null; displayName: string; roleSnapshot: string | null };
  moduleKey: string;
  category: string;
  severity: string;
  actionKey: string;
  entity: { type: string; id: string; label: string | null } | null;
  projectId: string | null;
};

export type AuditEventDetailDTO = AuditEventListItemDTO & {
  reason: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  correlationId: string | null;
  requestId: string | null;
  network: { ipAddress: string | null; userAgent: string | null } | null;
  metadata: Record<string, unknown> | null;
};

/** Default window keeps the first page fast at scale (PRD #28 §74). */
function resolveRange(query: AuditQuery): { gte: Date; lte?: Date } {
  const to = query.to ? new Date(query.to) : undefined;
  const from = query.from
    ? new Date(query.from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return to ? { gte: from, lte: to } : { gte: from };
}

function buildWhere(context: UserContext, query: AuditQuery): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = {
    // Company isolation is structural here, never a filter the caller supplies.
    companyId: context.companyId,
    occurredAt: resolveRange(query),
  };

  if (query.actorMemberIds?.length) where.actorMemberId = { in: query.actorMemberIds };
  if (query.actorTypes?.length) where.actorType = { in: query.actorTypes };
  if (query.moduleKeys?.length) where.moduleKey = { in: query.moduleKeys };
  if (query.categories?.length) where.category = { in: query.categories as never[] };
  if (query.actionKeys?.length) where.actionKey = { in: query.actionKeys };
  if (query.severities?.length) where.severity = { in: query.severities };
  if (query.projectIds?.length) where.projectId = { in: query.projectIds };
  if (query.entityTypes?.length) where.entityType = { in: query.entityTypes };

  if (query.query) {
    const term = query.query.trim();
    where.OR = [
      { actionKey: { contains: term, mode: "insensitive" } },
      { entityLabelSnapshot: { contains: term, mode: "insensitive" } },
      { actorDisplayNameSnapshot: { contains: term, mode: "insensitive" } },
      { correlationId: term },
      { requestId: term },
      { entityId: term },
    ];
  }

  return where;
}

function toListItem(row: {
  id: string;
  occurredAt: Date;
  actorType: string;
  actorMemberId: string | null;
  actorDisplayNameSnapshot: string | null;
  actorRoleSnapshot: string | null;
  moduleKey: string;
  category: string;
  severity: string;
  actionKey: string;
  entityType: string | null;
  entityId: string | null;
  entityLabelSnapshot: string | null;
  projectId: string | null;
}): AuditEventListItemDTO {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actor: {
      type: row.actorType,
      memberId: row.actorMemberId,
      // A deactivated member still reads as a person, not a blank (PRD #28 §69).
      displayName: row.actorDisplayNameSnapshot ?? (row.actorType === "USER" ? "Former member" : row.actorType),
      roleSnapshot: row.actorRoleSnapshot,
    },
    moduleKey: row.moduleKey,
    category: row.category,
    severity: row.severity,
    actionKey: row.actionKey,
    entity: row.entityType && row.entityId
      ? { type: row.entityType, id: row.entityId, label: row.entityLabelSnapshot }
      : null,
    projectId: row.projectId,
  };
}

export async function listAuditEvents(context: UserContext, query: AuditQuery) {
  assertPermission(context, "audit.view");

  const where = buildWhere(context, query);
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return {
    data: rows.map(toListItem),
    pagination: {
      page: query.page,
      limit: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

/** Strips sensitive values again for readers without audit.sensitive.view. */
function redactForReader(
  value: Record<string, unknown> | null,
  canSeeSensitive: boolean,
): Record<string, unknown> | null {
  if (!value || canSeeSensitive) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry === REDACTED ? REDACTED : entry;
  }
  return out;
}

export async function getAuditEvent(
  context: UserContext,
  id: string,
): Promise<AuditEventDetailDTO | null> {
  assertPermission(context, "audit.view");
  const canSeeSensitive = context.permissions.includes("audit.sensitive.view");

  const row = await prisma.auditEvent.findFirst({
    where: { id, companyId: context.companyId },
  });
  if (!row) return null;

  return {
    ...toListItem(row),
    reason: row.reason,
    changes: redactForReader(
      row.changesJson as Record<string, { before: unknown; after: unknown }> | null,
      canSeeSensitive,
    ) as AuditEventDetailDTO["changes"],
    before: redactForReader(row.beforeJson as Record<string, unknown> | null, canSeeSensitive),
    after: redactForReader(row.afterJson as Record<string, unknown> | null, canSeeSensitive),
    correlationId: row.correlationId,
    requestId: row.requestId,
    // IP and user agent identify a person's device: sensitive readers only
    // (PRD #28 §249, §250).
    network: canSeeSensitive ? { ipAddress: row.ipAddress, userAgent: row.userAgent } : null,
    metadata: row.metadataJson as Record<string, unknown> | null,
  };
}

/** Correlated events, so one workflow reads as a chain (PRD #28 §209-§212). */
export async function listCorrelatedEvents(context: UserContext, correlationId: string) {
  assertPermission(context, "audit.view");
  const rows = await prisma.auditEvent.findMany({
    where: { companyId: context.companyId, correlationId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  return rows.map(toListItem);
}

/**
 * CSV export of the audit log (PRD #28 §170-§174).
 *
 * Built on the same `buildWhere` the list uses, so the file is a copy of the
 * screen: same company scope, same filters, same redaction. An export that
 * queried independently would eventually disagree with the view it claims to
 * reproduce, and the direction it disagrees in is a disclosure.
 *
 * Three rules the PRD is specific about:
 *
 *   - a row cap, because an export is a spreadsheet and not a database dump;
 *   - the export is itself audited, since taking a copy of the evidence is an
 *     event an auditor wants to see;
 *   - and that audit does not recurse — the rows are read *before* the export
 *     event is written, so an export never contains the record of itself, and
 *     writing it triggers no further export.
 */
const MAX_EXPORT_ROWS = 5000;

export async function exportAuditEvents(
  context: UserContext,
  query: AuditQuery,
): Promise<{ filename: string; csv: string; rowCount: number }> {
  assertPermission(context, "audit.view");
  assertPermission(context, "audit.export");

  const canSeeSensitive = context.permissions.includes("audit.sensitive.view");

  const rows = await prisma.auditEvent.findMany({
    where: buildWhere(context, query),
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: MAX_EXPORT_ROWS,
  });

  const csv = toCsv(
    [
      "Occurred at",
      "Actor",
      "Actor type",
      "Role",
      "Module",
      "Category",
      "Severity",
      "Action",
      "Entity type",
      "Entity",
      "Reason",
      "Changes",
    ],
    rows.map((row) => {
      const item = toListItem(row);
      const changes = redactForReader(
        row.changesJson as Record<string, unknown> | null,
        canSeeSensitive,
      );
      return [
        item.occurredAt,
        item.actor.displayName,
        item.actor.type,
        item.actor.roleSnapshot ?? "",
        item.moduleKey,
        item.category,
        item.severity,
        item.actionKey,
        item.entity?.type ?? "",
        item.entity?.label ?? "",
        row.reason ?? "",
        changes ? JSON.stringify(changes) : "",
      ];
    }),
  );

  await recordUserAction(context, {
    actionKey: AuditAction.AUDIT_LOG_EXPORTED,
    entity: { type: "audit_log", id: context.companyId, label: "Audit log export" },
    metadata: { rowCount: rows.length, capped: rows.length === MAX_EXPORT_ROWS },
  });

  return { filename: "audit-log.csv", csv, rowCount: rows.length };
}

function toCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}
