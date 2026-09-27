import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordAuditEvent } from "@/lib/core/audit/audit.service";
import type { AuditContext } from "@/lib/core/audit/audit.types";
import { prisma as appPrisma } from "@/lib/database/prisma";
import { COMPANY, prisma } from "../../helpers";

/**
 * Optional audit inside a transaction (AUD-10 §6, gap 12).
 *
 * PostgreSQL aborts a transaction at its first failed statement. Before AUD-10
 * the audit writer caught an optional audit's failure and carried on — but the
 * caller's transaction was already dead, so the business write after it failed
 * with "current transaction is aborted" and the operation the audit was meant
 * to be optional to failed with it. The optional insert now runs under its own
 * SAVEPOINT; a required one still takes the business write down.
 *
 * The failure is real, not mocked: an audit event naming a parent group that
 * does not exist breaks its foreign key in the database.
 */

const ENTITY = "Aud10dAuditProbe";
const MISSING_GROUP: AuditContext = { companyId: null, parentGroupId: "aud10d_missing_group", actor: { type: "SYSTEM" } };
const VALID: AuditContext = { companyId: COMPANY.a, actor: { type: "SYSTEM" } };

async function businessRow(tx: Prisma.TransactionClient, tag: string) {
  await tx.activity.create({ data: { companyId: COMPANY.a, module: "tasks", entityType: ENTITY, entityId: `aud10d_${tag}`, action: "PROBE", message: "probe" } });
}

async function rows(tag: string) {
  return prisma.activity.count({ where: { entityType: ENTITY, entityId: `aud10d_${tag}` } });
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityType: ENTITY } });
  await prisma.activity.deleteMany({ where: { entityType: ENTITY } });
  await prisma.$disconnect();
});

describe("optional audit inside a transaction (gap 12)", () => {
  it("a failed optional audit leaves the caller's transaction usable, and it commits", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await appPrisma.$transaction(async (tx) => {
      await businessRow(tx, "optional_before");
      await recordAuditEvent(MISSING_GROUP, { actionKey: AuditAction.USER_PROFILE_UPDATED, entity: { type: ENTITY, id: "aud10d_optional_fail" } }, { tx });
      // Before the savepoint this statement failed: 25P02 in_failed_sql_transaction.
      await businessRow(tx, "optional_after");
    });
    expect(quiet).toHaveBeenCalledWith("audit.write.failed", expect.objectContaining({ actionKey: AuditAction.USER_PROFILE_UPDATED }));
    quiet.mockRestore();

    expect(await rows("optional_before")).toBe(1);
    expect(await rows("optional_after")).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityType: ENTITY, entityId: "aud10d_optional_fail" } })).toBe(0);
  });

  it("a failed required audit fails the business operation and rolls every write of it back", async () => {
    await expect(
      appPrisma.$transaction(async (tx) => {
        await businessRow(tx, "required_before");
        await recordAuditEvent(MISSING_GROUP, { actionKey: AuditAction.TEAM_MEMBER_ROLE_CHANGED, entity: { type: ENTITY, id: "aud10d_required_fail" } }, { tx });
        await businessRow(tx, "required_after");
      }),
    ).rejects.toThrow();

    expect(await rows("required_before")).toBe(0);
    expect(await rows("required_after")).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityType: ENTITY, entityId: "aud10d_required_fail" } })).toBe(0);
  });

  it("positive control: a successful optional audit commits with the transaction, after a failed one in the same transaction", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await appPrisma.$transaction(async (tx) => {
      await recordAuditEvent(MISSING_GROUP, { actionKey: AuditAction.USER_PROFILE_UPDATED, entity: { type: ENTITY, id: "aud10d_mixed_fail" } }, { tx });
      await recordAuditEvent(VALID, { actionKey: AuditAction.USER_PROFILE_UPDATED, entity: { type: ENTITY, id: "aud10d_mixed_ok" } }, { tx });
      await businessRow(tx, "mixed");
    });
    quiet.mockRestore();

    expect(await rows("mixed")).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityType: ENTITY, entityId: "aud10d_mixed_ok" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityType: ENTITY, entityId: "aud10d_mixed_fail" } })).toBe(0);
  });

  it("the savepoint is not an autonomous commit: an optional audit rolls back with a business write that fails", async () => {
    await expect(
      appPrisma.$transaction(async (tx) => {
        await recordAuditEvent(VALID, { actionKey: AuditAction.USER_PROFILE_UPDATED, entity: { type: ENTITY, id: "aud10d_rolled_back" } }, { tx });
        await businessRow(tx, "rolled_back");
        throw new Error("business rule refused");
      }),
    ).rejects.toThrow("business rule refused");

    expect(await rows("rolled_back")).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityType: ENTITY, entityId: "aud10d_rolled_back" } })).toBe(0);
  });

  it("outside a transaction a failed optional audit is logged and swallowed; a required one throws", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordAuditEvent(MISSING_GROUP, { actionKey: AuditAction.USER_PROFILE_UPDATED, entity: { type: ENTITY, id: "aud10d_bare" } })).resolves.toBeUndefined();
    quiet.mockRestore();
    await expect(recordAuditEvent(MISSING_GROUP, { actionKey: AuditAction.TEAM_MEMBER_ROLE_CHANGED, entity: { type: ENTITY, id: "aud10d_bare_required" } })).rejects.toThrow();
    expect(await prisma.auditEvent.count({ where: { entityType: ENTITY } })).toBe(1); // the mixed_ok row above only
  });
});
