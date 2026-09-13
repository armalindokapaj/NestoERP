import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import {
  auditQuerySchema,
  exportAuditEvents,
  listAuditEvents,
} from "@/lib/core/audit/audit-query.service";
import * as team from "@/lib/modules/team/team.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * The audit trail actually records (PRD #28 §45-§50, §95, §170-§174).
 *
 * The gap audit of 2026-09-13 found the registry declaring 52 actions while
 * the product emitted 9. `tests/unit/audit/audit-coverage.test.ts` proves
 * statically that no policy is silent; this file proves the writes land, with
 * the right company, the right actor and the declared redaction — the part a
 * static scan cannot see.
 */
const writtenEventIds: string[] = [];

async function newestEvent(companyId: string, actionKey: string) {
  return prisma.auditEvent.findFirst({
    where: { companyId, actionKey },
    orderBy: { occurredAt: "desc" },
  });
}

afterEach(async () => {
  if (writtenEventIds.length > 0) {
    await prisma.auditEvent.deleteMany({ where: { id: { in: writtenEventIds } } });
    writtenEventIds.length = 0;
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("access-control events are recorded (PRD #28 §95)", () => {
  it("records a suspension with the actor, the company and the status change", async () => {
    const owner = await loginAs("OWNER");
    const target = await loginAs("ENGINEER");

    const before = await newestEvent(owner.companyId, AuditAction.TEAM_MEMBER_SUSPENDED);

    await team.suspendMember(owner, target.membershipId);

    const after = await newestEvent(owner.companyId, AuditAction.TEAM_MEMBER_SUSPENDED);
    expect(after).not.toBeNull();
    expect(after!.id).not.toBe(before?.id);
    writtenEventIds.push(after!.id);

    expect(after!.companyId).toBe(owner.companyId);
    expect(after!.actorType).toBe("USER");
    expect(after!.actorMemberId).toBe(owner.membershipId);
    expect(after!.entityId).toBe(target.membershipId);
    expect(after!.category).toBe("ACCESS_CONTROL");
    expect(after!.changesJson).toMatchObject({ status: { after: "SUSPENDED" } });

    // Leave the seeded world as it was found.
    await team.unsuspendMember(owner, target.membershipId);
    const restored = await newestEvent(owner.companyId, AuditAction.TEAM_MEMBER_ACTIVATED);
    if (restored) writtenEventIds.push(restored.id);
  });

  /**
   * The point of a `required` policy: `audit.service.ts` writes it inside the
   * caller's transaction, so evidence and mutation commit together. A refused
   * suspension must therefore leave no audit row behind either.
   */
  it("writes nothing when the action itself is refused", async () => {
    const engineer = await loginAs("ENGINEER");
    const target = await loginAs("ARCHITECT");

    const before = await newestEvent(engineer.companyId, AuditAction.TEAM_MEMBER_SUSPENDED);

    await expect(team.suspendMember(engineer, target.membershipId)).rejects.toBeInstanceOf(
      AccessError,
    );

    const after = await newestEvent(engineer.companyId, AuditAction.TEAM_MEMBER_SUSPENDED);
    expect(after?.id).toBe(before?.id);
  });
});

describe("reading the log (PRD #28 §151-§158)", () => {
  it("never returns another company's events", async () => {
    const owner = await loginAs("OWNER");

    const { data } = await listAuditEvents(
      owner,
      auditQuerySchema.parse({ page: 1, pageSize: 100 }),
    );

    const ids = data.map((row) => row.id);
    const foreign = await prisma.auditEvent.count({
      where: { id: { in: ids }, companyId: { not: owner.companyId } },
    });

    expect(foreign).toBe(0);
  });

  it("refuses a reader without audit.view", async () => {
    const engineer = await loginAs("ENGINEER");

    await expect(
      listAuditEvents(engineer, auditQuerySchema.parse({ page: 1, pageSize: 10 })),
    ).rejects.toBeInstanceOf(AccessError);
  });
});

describe("exporting the log (PRD #28 §170-§174)", () => {
  it("audits the export, and the file never contains the record of itself", async () => {
    const owner = await loginAs("OWNER");
    // An explicit window rather than the rolling 30-day default, so the two
    // exports below are counting the same set of rows.
    const query = () =>
      auditQuerySchema.parse({ from: "2000-01-01T00:00:00.000Z", page: 1, pageSize: 100 });

    const first = await exportAuditEvents(owner, query());

    expect(first.filename).toBe("audit-log.csv");
    expect(first.csv.split("\r\n")).toHaveLength(first.rowCount + 1); // header + rows

    const event = await newestEvent(owner.companyId, AuditAction.AUDIT_LOG_EXPORTED);
    expect(event).not.toBeNull();
    writtenEventIds.push(event!.id);
    expect(event!.metadataJson).toMatchObject({ rowCount: first.rowCount });

    /*
     * The no-recursion rule: rows are read before the export event is written,
     * so an export never contains the record of itself. The proof is that the
     * next export sees exactly one row more — the first export's own event —
     * rather than the first export having counted itself.
     */
    const second = await exportAuditEvents(owner, query());
    writtenEventIds.push((await newestEvent(owner.companyId, AuditAction.AUDIT_LOG_EXPORTED))!.id);

    expect(second.rowCount).toBe(first.rowCount + 1);
  });

  it("refuses a reader who may view the log but not take a copy", async () => {
    const engineer = await loginAs("ENGINEER");

    await expect(
      exportAuditEvents(engineer, auditQuerySchema.parse({ page: 1, pageSize: 10 })),
    ).rejects.toBeInstanceOf(AccessError);
  });
});
