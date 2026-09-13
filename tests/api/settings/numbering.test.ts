import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { allocateNumber, isAutoNumbered } from "@/lib/core/numbering/numbering.service";
import {
  listNumberingSchemes,
  numberingSchemeSchema,
  updateNumberingScheme,
} from "@/lib/modules/settings/numbering.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Record numbering (PRD #24 §102, §111-§119).
 *
 * The 2026-09-13 gap audit found `allocateNumber` with no caller anywhere:
 * invoice and contract numbers were whatever somebody typed, checked only for
 * uniqueness, while the settings page previewed a scheme that governed
 * nothing. These tests cover the two things that then matter — that the scheme
 * is applied, and that two records raised at the same instant cannot take the
 * same number.
 */
const TARGET = { moduleKey: "finance", entityType: "invoice" } as const;

async function snapshot(companyId: string) {
  return prisma.companyNumberingScheme.findUniqueOrThrow({
    where: {
      companyId_moduleKey_entityType: {
        companyId,
        moduleKey: TARGET.moduleKey,
        entityType: TARGET.entityType,
      },
    },
  });
}

afterEach(async () => {
  const owner = await loginAs("OWNER");
  const row = await snapshot(owner.companyId);

  // Restore the scheme itself; the sequence only ever moves forward, which is
  // the point of it, so it is deliberately not rewound.
  await prisma.companyNumberingScheme.update({
    where: { id: row.id },
    data: { mode: "AUTO", prefix: "INV", separator: "-", yearMode: "YYYY", padding: 4 },
  });

  await prisma.auditEvent.deleteMany({
    where: { actionKey: AuditAction.COMPANY_NUMBERING_CHANGED, companyId: owner.companyId },
  });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("allocation (PRD #24 §102)", () => {
  it("hands out consecutive numbers and advances the sequence", async () => {
    const owner = await loginAs("OWNER");
    const target = { companyId: owner.companyId, ...TARGET };

    const before = await snapshot(owner.companyId);

    const first = await allocateNumber(target);
    const second = await allocateNumber(target);

    expect(first).not.toBeNull();
    expect(first).not.toBe(second);

    const after = await snapshot(owner.companyId);
    expect(after.nextSequence).toBe(before.nextSequence + 2);
  });

  /**
   * The reason allocation takes `FOR UPDATE` rather than reading and writing.
   * Two invoices raised at the same instant must not be given the same number:
   * a duplicate here is a duplicate in somebody's accounts.
   */
  it("gives ten simultaneous allocations ten different numbers", async () => {
    const owner = await loginAs("OWNER");
    const target = { companyId: owner.companyId, ...TARGET };

    const numbers = await Promise.all(Array.from({ length: 10 }, () => allocateNumber(target)));

    expect(new Set(numbers).size).toBe(10);
    expect(numbers.every((value) => typeof value === "string")).toBe(true);
  });

  it("returns nothing when the company numbers this record type manually", async () => {
    const owner = await loginAs("OWNER");

    await prisma.companyNumberingScheme.updateMany({
      where: { companyId: owner.companyId, ...TARGET },
      data: { mode: "MANUAL" },
    });

    expect(await isAutoNumbered({ companyId: owner.companyId, ...TARGET })).toBe(false);
    expect(await allocateNumber({ companyId: owner.companyId, ...TARGET })).toBeNull();
  });

  it("never crosses companies", async () => {
    const owner = await loginAs("OWNER");

    const other = await prisma.company.findFirst({
      where: { id: { not: owner.companyId } },
      select: { id: true },
    });
    if (!other) return;

    const before = await prisma.companyNumberingScheme.findUnique({
      where: {
        companyId_moduleKey_entityType: { companyId: other.id, ...TARGET },
      },
      select: { nextSequence: true },
    });

    await allocateNumber({ companyId: owner.companyId, ...TARGET });

    const after = await prisma.companyNumberingScheme.findUnique({
      where: {
        companyId_moduleKey_entityType: { companyId: other.id, ...TARGET },
      },
      select: { nextSequence: true },
    });

    expect(after?.nextSequence).toBe(before?.nextSequence);
  });
});

describe("administering a scheme (PRD #24 §114-§119)", () => {
  it("applies a change and records it", async () => {
    const owner = await loginAs("OWNER");

    const updated = await updateNumberingScheme(
      owner,
      TARGET.moduleKey,
      TARGET.entityType,
      numberingSchemeSchema.parse({
        mode: "AUTO",
        prefix: "BILL",
        separator: "/",
        yearMode: "YY",
        padding: 5,
        resetSequenceYearly: true,
      }),
    );

    expect(updated.prefix).toBe("BILL");
    expect(updated.preview).toContain("BILL/");

    const event = await prisma.auditEvent.findFirst({
      where: {
        companyId: owner.companyId,
        actionKey: AuditAction.COMPANY_NUMBERING_CHANGED,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect(event!.changesJson).toMatchObject({ prefix: { after: "BILL" } });
  });

  it("refuses somebody without company.numbering.manage", async () => {
    const engineer = await loginAs("ENGINEER");

    await expect(
      updateNumberingScheme(
        engineer,
        TARGET.moduleKey,
        TARGET.entityType,
        numberingSchemeSchema.parse({
          mode: "MANUAL",
          separator: "-",
          yearMode: "NONE",
          padding: 4,
          resetSequenceYearly: false,
        }),
      ),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("shows every scheme with a live preview", async () => {
    const owner = await loginAs("OWNER");
    const schemes = await listNumberingSchemes(owner);

    expect(schemes.length).toBeGreaterThan(0);
    for (const scheme of schemes) {
      expect(scheme.preview.length).toBeGreaterThan(0);
      expect(scheme.canManage).toBe(true);
    }
  });
});
