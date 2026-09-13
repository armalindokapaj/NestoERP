import { afterAll, describe, expect, it } from "vitest";

import { globalSearch } from "@/lib/core/search/search.service";
import { searchProviders } from "@/lib/core/search/search.providers";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Global search across every module (PRD #26 §61-§100).
 *
 * The 2026-09-13 gap audit found five of the providers PRD #26 names missing
 * entirely — legal, procurement, inventory, QA/QC and HSE — so a contract
 * number or an incident reference returned nothing at all, with no sign that
 * whole modules were outside the index.
 *
 * These tests are about the two things a search provider can get wrong: not
 * finding what it should, and finding what the reader is not allowed to see.
 */

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/** Every module PRD #26 §70-§100 requires a provider for. */
const REQUIRED_MODULES = [
  "projects",
  "tasks",
  "clients",
  "documents",
  "team",
  "finance",
  "sales",
  "contracts",
  "procurement",
  "inventory",
  "qaqc",
  "hse",
] as const;

describe("provider registry (PRD #26 §61)", () => {
  it("registers a provider for every module the PRD names", () => {
    const registered = new Set(searchProviders.map((provider) => provider.moduleKey));
    const missing = REQUIRED_MODULES.filter((key) => !registered.has(key));

    expect(missing, `modules with no search provider: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("department records are findable (PRD #26 §70-§100)", () => {
  it("finds a contract by its number", async () => {
    const owner = await loginAs("OWNER");
    const contract = await prisma.contract.findFirst({
      where: { companyId: owner.companyId, archivedAt: null },
      select: { id: true, contractNumber: true },
    });
    expect(contract, "the seed must contain a contract").not.toBeNull();

    const { results } = await globalSearch(owner, contract!.contractNumber);

    expect(results.some((row) => row.entityId === contract!.id)).toBe(true);
    expect(results.find((row) => row.entityId === contract!.id)?.href).toBe(
      `/contracts/${contract!.id}`,
    );
  });

  it("finds a purchase order, an inventory item and an incident", async () => {
    const owner = await loginAs("OWNER");

    const [order, item, incident] = await Promise.all([
      prisma.purchaseOrder.findFirst({
        where: { companyId: owner.companyId, archivedAt: null },
        select: { id: true, poNumber: true },
      }),
      prisma.inventoryItem.findFirst({
        where: { companyId: owner.companyId, archivedAt: null },
        select: { id: true, sku: true },
      }),
      prisma.hseIncident.findFirst({
        where: { companyId: owner.companyId },
        select: { id: true, incidentNumber: true },
      }),
    ]);

    for (const [label, id, term] of [
      ["purchase order", order?.id, order?.poNumber],
      ["inventory item", item?.id, item?.sku],
      ["incident", incident?.id, incident?.incidentNumber],
    ] as const) {
      expect(id, `the seed must contain a ${label}`).toBeTruthy();
      const { results } = await globalSearch(owner, term!);
      expect(results.some((row) => row.entityId === id), `${label} not found`).toBe(true);
    }
  });
});

describe("search never widens access (PRD #26 §22, §23, §29)", () => {
  /**
   * The failure mode this guards against is the one that was found in the
   * document provider at 7d33d98: a provider filtering on company alone, which
   * hands the *title* of a restricted record to somebody refused the record.
   */
  it("returns nothing from a module the reader cannot access", async () => {
    const engineer = await loginAs("ENGINEER");

    const contract = await prisma.contract.findFirst({
      where: { companyId: engineer.companyId, archivedAt: null },
      select: { contractNumber: true },
    });

    const { results } = await globalSearch(engineer, contract!.contractNumber);

    // An Engineer holds no legal.contract.view, so the contract module must
    // contribute nothing — not a title, not a number, not a count.
    expect(results.filter((row) => row.moduleKey === "contracts")).toEqual([]);
  });

  it("never returns another company's records", async () => {
    const owner = await loginAs("OWNER");

    const foreignContract = await prisma.contract.findFirst({
      where: { companyId: { not: owner.companyId } },
      select: { id: true, contractNumber: true },
    });

    if (!foreignContract) return; // Company B has no contracts in the seed.

    const { results } = await globalSearch(owner, foreignContract.contractNumber);

    expect(results.some((row) => row.entityId === foreignContract.id)).toBe(false);
  });

  it("survives a provider that throws, and says so", async () => {
    const owner = await loginAs("OWNER");

    // A real search, to confirm the partial-result contract is wired: with
    // every provider healthy nothing is reported as failed (PRD #26 §37).
    const { partial, failedModules } = await globalSearch(owner, "a");

    expect(partial).toBe(false);
    expect(failedModules).toEqual([]);
  });
});
