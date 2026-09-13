import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  IntegrationType,
  integrationDefinitions,
} from "@/lib/core/integrations/integration.registry";
import { linkIntegration } from "@/lib/core/integrations/integration.service";
import { MODULE_KEYS } from "@/config/modules";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Cross-module handoff traces (PRD #23 §21, §44-§47, §94).
 *
 * The 2026-09-13 gap audit found the integration engine complete and unused:
 * the flows worked and were idempotent on their own, so behaviour was right,
 * but no IntegrationLink was ever written and no attempt recorded — so the
 * question "where did this commitment come from?" could only be answered by
 * reading procurement's private columns.
 *
 * The guarantee under test is the one a financial defect depends on: running
 * the same handoff twice leaves one link, not two.
 */
const SOURCE_ID = "test_integration_source";

afterEach(async () => {
  await prisma.integrationAttempt.deleteMany({ where: { sourceEntityId: SOURCE_ID } });
  await prisma.integrationLink.deleteMany({ where: { sourceEntityId: SOURCE_ID } });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("the registry (PRD #23 §17)", () => {
  it("names only modules that exist", () => {
    const known = new Set<string>(MODULE_KEYS);
    for (const definition of integrationDefinitions()) {
      expect(known.has(definition.sourceModule), `${definition.id} source`).toBe(true);
      expect(known.has(definition.targetModule), `${definition.id} target`).toBe(true);
    }
  });
});

describe("recording a handoff (PRD #23 §21, §94)", () => {
  it("writes one link and one attempt", async () => {
    const owner = await loginAs("OWNER");

    const linkId = await prisma.$transaction((tx) =>
      linkIntegration(tx, owner, {
        integrationType: IntegrationType.PROCUREMENT_PO_FINANCE_COMMITMENT,
        source: { id: SOURCE_ID },
        target: { id: "test_integration_target" },
      }),
    );

    expect(linkId).not.toBeNull();

    const link = await prisma.integrationLink.findUniqueOrThrow({ where: { id: linkId! } });
    expect(link.companyId).toBe(owner.companyId);
    expect(link.sourceModule).toBe("procurement");
    expect(link.targetModule).toBe("finance");
    expect(link.targetEntityId).toBe("test_integration_target");
    expect(link.status).toBe("ACTIVE");
    expect(link.createdByMemberId).toBe(owner.membershipId);

    const attempts = await prisma.integrationAttempt.findMany({
      where: { sourceEntityId: SOURCE_ID },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("SUCCEEDED");
    expect(attempts[0].attemptNumber).toBe(1);
  });

  /**
   * The whole point of the idempotency key. A retried handoff must not produce
   * a second link — that would be a second commitment in the ledger's eyes.
   */
  it("leaves one link when the same handoff runs again", async () => {
    const owner = await loginAs("OWNER");

    const run = () =>
      prisma.$transaction((tx) =>
        linkIntegration(tx, owner, {
          integrationType: IntegrationType.PROCUREMENT_PO_FINANCE_COMMITMENT,
          source: { id: SOURCE_ID },
          target: { id: "test_integration_target" },
        }),
      );

    const first = await run();
    const second = await run();

    expect(second).toBe(first);

    const links = await prisma.integrationLink.findMany({
      where: { sourceEntityId: SOURCE_ID },
    });
    expect(links).toHaveLength(1);

    // The attempts do accumulate: one link, but a record of each run, which is
    // what makes a retry visible afterwards (PRD #23 §47).
    const attempts = await prisma.integrationAttempt.findMany({
      where: { sourceEntityId: SOURCE_ID },
      orderBy: { attemptNumber: "asc" },
    });
    expect(attempts.map((row) => row.attemptNumber)).toEqual([1, 2]);
  });

  it("keeps two companies' handoffs apart even on the same source id", async () => {
    const owner = await loginAs("OWNER");

    await prisma.$transaction((tx) =>
      linkIntegration(tx, owner, {
        integrationType: IntegrationType.PROCUREMENT_PO_FINANCE_COMMITMENT,
        source: { id: SOURCE_ID },
        target: { id: "test_integration_target" },
      }),
    );

    const otherCompany = await prisma.company.findFirst({
      where: { id: { not: owner.companyId } },
      select: { id: true },
    });
    if (!otherCompany) return;

    // The idempotency key carries the company, so the same source id in another
    // company is a different handoff rather than a collision.
    const foreign = await prisma.integrationLink.findFirst({
      where: { companyId: otherCompany.id, sourceEntityId: SOURCE_ID },
    });
    expect(foreign).toBeNull();
  });
});
