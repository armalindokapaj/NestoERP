import type { PrismaClient } from "@prisma/client";

import { AuditAction, auditPolicies } from "../../lib/core/audit/audit-policy.registry";

/**
 * Audit seed (PRD #28 §297-§308).
 *
 * Enough evidence to exercise every filter the viewer offers: all categories,
 * all three actor types, all three severities, a correlation chain, and another
 * tenant whose events must never appear in the demo's log (PRD #28 §320).
 */

const POLICIES = auditPolicies();

export async function seedAuditEvents(
  prisma: PrismaClient,
  companies: { companyA: { id: string }; tenant: { id: string } },
) {
  const existing = await prisma.auditEvent.count();
  if (existing > 0) return { created: 0 };

  // Real memberships, so every actor snapshot points at somebody who exists.
  const memberRows = await prisma.companyMember.findMany({
    where: { companyId: companies.companyA.id },
    select: { id: true, userId: true, role: { select: { key: true } } },
  });

  const actors: Array<[string, { id: string; userId: string }]> = memberRows.map((m) => [
    m.role.key,
    { id: m.id, userId: m.userId },
  ]);

  if (actors.length === 0) return { created: 0 };

  const rows: Array<Record<string, unknown>> = [];
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // Spread across the last 45 days so date filtering has something to bite on.
  POLICIES.forEach((policy, index) => {
    const repeats = policy.severity === "CRITICAL" ? 3 : policy.severity === "IMPORTANT" ? 6 : 5;

    for (let i = 0; i < repeats; i += 1) {
      const [roleKey, actor] = actors[(index + i) % actors.length];
      rows.push({
        companyId: companies.companyA.id,
        occurredAt: new Date(now - ((index * 7 + i * 3) % 45) * DAY - i * 3600_000),
        actorType: "USER",
        actorUserId: actor.userId,
        actorMemberId: actor.id,
        actorDisplayNameSnapshot: roleKey
          .split("_")
          .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
          .join(" "),
        actorRoleSnapshot: roleKey,
        moduleKey: policy.moduleKey,
        category: policy.category,
        severity: policy.severity,
        actionKey: policy.actionKey,
        entityType: "demo_record",
        entityId: `demo_${index}_${i}`,
        entityLabelSnapshot: `${policy.actionKey.split("_").slice(-2).join(" ")} ${index}-${i}`,
        changesJson: policy.snapshotMode === "NONE" ? undefined : { status: { before: "PENDING", after: "APPROVED" } },
      });
    }
  });

  // A SYSTEM actor: the platform acting on its own (PRD #28 §15, §205).
  rows.push({
    companyId: companies.companyA.id,
    occurredAt: new Date(now - 2 * DAY),
    actorType: "SYSTEM",
    moduleKey: "settings",
    category: "SYSTEM",
    severity: "INFO",
    actionKey: AuditAction.COMPANY_SETTINGS_UPDATED,
    entityType: "company_settings",
    entityId: companies.companyA.id,
    entityLabelSnapshot: "Scheduled configuration check",
  });

  // One correlation chain: approval, then the commitment it created
  // (PRD #28 §52, §300).
  const correlationId = "corr_demo_po_commitment";
  const [, chainActor] = actors[0];
  rows.push(
    {
      companyId: companies.companyA.id,
      occurredAt: new Date(now - DAY),
      actorType: "USER",
      actorUserId: chainActor.userId,
      actorMemberId: chainActor.id,
      actorDisplayNameSnapshot: "Procurement Lead",
      actorRoleSnapshot: "PROCUREMENT",
      moduleKey: "finance",
      category: "FINANCIAL",
      severity: "IMPORTANT",
      actionKey: AuditAction.FINANCE_COMMITMENT_CREATED,
      entityType: "commitment",
      entityId: "demo_commitment_1",
      entityLabelSnapshot: "COM-2026-0001",
      correlationId,
    },
    {
      companyId: companies.companyA.id,
      occurredAt: new Date(now - DAY - 60_000),
      actorType: "INTEGRATION",
      moduleKey: "finance",
      category: "FINANCIAL",
      severity: "IMPORTANT",
      actionKey: AuditAction.FINANCE_COMMITMENT_CREATED,
      entityType: "commitment",
      entityId: "demo_commitment_1",
      entityLabelSnapshot: "COM-2026-0001",
      correlationId,
      metadataJson: { initiatedByMemberId: chainActor.id, sourceModule: "procurement" },
    },
  );

  // The fixture tenant, with overlapping labels, so isolation is genuinely tested.
  rows.push({
    companyId: companies.tenant.id,
    occurredAt: new Date(now - 3 * DAY),
    actorType: "USER",
    actorDisplayNameSnapshot: "Tenant Owner",
    actorRoleSnapshot: "OWNER",
    moduleKey: "settings",
    category: "CONFIGURATION",
    severity: "CRITICAL",
    actionKey: AuditAction.COMPANY_MODULE_DISABLED,
    entityType: "company_module",
    entityId: "finance",
    entityLabelSnapshot: "Finance",
    changesJson: { enabled: { before: true, after: false } },
  });

  await prisma.auditEvent.createMany({ data: rows as never });
  return { created: rows.length };
}
