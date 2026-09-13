import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * Workflow K — Won opportunity to delivery project (PRD #35 §179).
 *
 * The only workflow in #35's matrix with no test at all when the release
 * review walked it. The flow existed and was correct; nothing asserted it.
 *
 * NESTO links a won deal to an existing project rather than creating one from
 * it, which is what makes the handoff idempotent for free: repeating it sets
 * the same field to the same value. The rules worth holding are that only a
 * won deal hands over, and that it hands over to its own client's project.
 */

/**
 * What each test changed, and what it was before.
 *
 * Restoring the *previous* value rather than nulling it: the seed links
 * several won opportunities to their delivery projects on purpose, and other
 * suites assert that chain. Clearing it would leave the seeded world subtly
 * wrong for everything that runs afterwards.
 */
const touched = new Map<string, string | null>();

afterEach(async () => {
  for (const [id, convertedProjectId] of touched) {
    await prisma.opportunity.update({ where: { id }, data: { convertedProjectId } });
  }
  touched.clear();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function wonOpportunity(companyId: string) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { companyId, stage: "WON", archivedAt: null },
    select: { id: true, clientId: true, convertedProjectId: true },
  });
  expect(opportunity, "the seed must contain a won opportunity").not.toBeNull();
  return opportunity!;
}

describe("handing a won deal to delivery (PRD #35 §179)", () => {
  it("links the opportunity to the project", async () => {
    const sales = await loginAs("SALES");
    const opportunity = await wonOpportunity(sales.companyId);

    const project = await prisma.project.findFirstOrThrow({
      where: { companyId: sales.companyId, clientId: opportunity.clientId },
      select: { id: true },
    });

    touched.set(opportunity.id, opportunity.convertedProjectId);
    await opportunities.linkProject(sales, opportunity.id, project.id);

    const after = await prisma.opportunity.findUniqueOrThrow({
      where: { id: opportunity.id },
      select: { convertedProjectId: true },
    });
    expect(after.convertedProjectId).toBe(project.id);
  });

  /**
   * Idempotent by construction: linking sets a field rather than creating a
   * record, so repeating the handoff cannot produce a second project — which
   * is the failure §46 is really about.
   */
  it("is idempotent when repeated", async () => {
    const sales = await loginAs("SALES");
    const opportunity = await wonOpportunity(sales.companyId);

    const project = await prisma.project.findFirstOrThrow({
      where: { companyId: sales.companyId, clientId: opportunity.clientId },
      select: { id: true },
    });

    const before = await prisma.project.count({ where: { companyId: sales.companyId } });

    touched.set(opportunity.id, opportunity.convertedProjectId);
    await opportunities.linkProject(sales, opportunity.id, project.id);
    await opportunities.linkProject(sales, opportunity.id, project.id);

    expect(await prisma.project.count({ where: { companyId: sales.companyId } })).toBe(before);
  });

  it("refuses a deal that has not been won", async () => {
    const sales = await loginAs("SALES");

    const open = await prisma.opportunity.findFirst({
      where: { companyId: sales.companyId, stage: { notIn: ["WON", "LOST"] }, archivedAt: null },
      select: { id: true },
    });
    if (!open) return;

    await expect(
      opportunities.linkProject(sales, open.id, PROJECT.a),
    ).rejects.toBeInstanceOf(AccessError);
  });

  /**
   * A won deal must hand over to its own client's project. Otherwise the
   * delivery work, the invoices that follow it and the client record stop
   * agreeing with each other.
   */
  it("refuses a project belonging to a different client", async () => {
    const sales = await loginAs("SALES");
    const opportunity = await wonOpportunity(sales.companyId);

    const otherClientProject = await prisma.project.findFirst({
      where: {
        companyId: sales.companyId,
        clientId: { not: opportunity.clientId },
        NOT: { clientId: null },
      },
      select: { id: true },
    });
    if (!otherClientProject) return;

    await expect(
      opportunities.linkProject(sales, opportunity.id, otherClientProject.id),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("refuses somebody without sales.project.convert", async () => {
    const engineer = await loginAs("ENGINEER");
    const owner = await loginAs("OWNER");
    const opportunity = await wonOpportunity(owner.companyId);

    await expect(
      opportunities.linkProject(engineer, opportunity.id, PROJECT.a),
    ).rejects.toBeInstanceOf(AccessError);
  });
});
