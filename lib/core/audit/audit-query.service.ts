import { Prisma } from "@prisma/client";
import { z } from "zod";

import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { pageWindow, skipFor } from "@/lib/modules/shared/list-query";
import { REDACTED } from "./audit-redaction";

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
  // A page that is not a page number is page 1, not an error page (AUD-08 §3).
  page: z.coerce.number().int().min(1).default(1).catch(1),
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

  // One evaluation instant (the default 30-day window is resolved once, here) and one snapshot for the
  // count and the page; a page past the end reads the last real page (AUD-08 §4, DT-05, DT-06).
  const where = buildWhere(context, query);
  const { rows, window } = await runInTransaction(
    "audit.events.list",
    async (tx) => {
      const window = pageWindow(await tx.auditEvent.count({ where }), query.page, query.pageSize);
      const rows = await tx.auditEvent.findMany({
        where,
        // Newest first; the id breaks a same-instant tie (AUD-08 §4, DT-04).
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: skipFor(window.page, window.limit),
        take: window.limit,
      });
      return { rows, window };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 },
  );

  return {
    data: rows.map(toListItem),
    pagination: { page: window.page, limit: window.limit, total: window.total, totalPages: window.totalPages },
  };
}

/** Strips sensitive values again for readers without audit.sensitive.view (the list, the detail and the export). */
export function redactForReader(
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
