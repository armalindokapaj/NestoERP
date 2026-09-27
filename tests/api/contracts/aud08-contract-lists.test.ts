import { Prisma, type ContractStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { contractSectionSearch, parseContractQuery } from "@/lib/modules/contracts/contract.query";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import type { ContractView } from "@/lib/modules/contracts/contracts/contract.schema";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, prisma } from "../../helpers";

/**
 * AUD-08 on the contract register (DT-02, DT-03, DT-04, DT-05, DT-22).
 *
 * The eight section pages are one list with a section restriction. Each
 * fixture is in exactly one section, so the expected ids per section are
 * written out by hand; the export's address is checked to carry the section,
 * so a file from `/contracts/active` is the active contracts (DT-02).
 */

const PREFIX = "aud08c2_con";
const SEARCH = "AUD08C2-CON";
const OWNER_A = "member_legal";
const OWNER_B = "member_legal__b";
const at = (day: string) => new Date(`${day}T00:00:00.000Z`);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

const K = {
  draft: `${PREFIX}_01`,
  review: `${PREFIX}_02`,
  active: `${PREFIX}_03`, // expires in 400 days: active, not expiring
  expiring: `${PREFIX}_04`, // expires in 10 days: active and expiring
  expired: `${PREFIX}_05`,
  terminated: `${PREFIX}_06`,
  archived: `${PREFIX}_07`,
  activeNoExpiry: `${PREFIX}_08`, // active, no expiry date: never "expiring"
  foreign: `${PREFIX}_09`, // company B, active
};

async function removeFixtures() {
  await prisma.contract.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  const row = (id: string, status: ContractStatus, expiryDate: Date | null, companyId: string = COMPANY.a) => ({
    id,
    companyId,
    contractNumber: `${SEARCH}-${id.slice(-2)}`,
    title: `${SEARCH} ${status.toLowerCase()}`,
    contractType: "SERVICE_AGREEMENT" as const,
    status: status === "ARCHIVED" ? ("ACTIVE" as const) : status,
    archivedAt: status === "ARCHIVED" ? at("2026-01-15") : null,
    preArchiveStatus: status === "ARCHIVED" ? ("ACTIVE" as const) : null,
    expiryDate,
    effectiveDate: at("2026-01-01"),
    currency: "EUR",
    contractValue: new Prisma.Decimal("1000.00"),
    ownerMemberId: companyId === COMPANY.a ? OWNER_A : OWNER_B,
    createdByMemberId: companyId === COMPANY.a ? OWNER_A : OWNER_B,
  });
  await prisma.contract.createMany({
    data: [
      row(K.draft, "DRAFT", null),
      row(K.review, "IN_REVIEW", null),
      row(K.active, "ACTIVE", inDays(400)),
      row(K.expiring, "ACTIVE", inDays(10)),
      row(K.expired, "EXPIRED", at("2026-02-01")),
      row(K.terminated, "TERMINATED", null),
      row(K.archived, "ARCHIVED", null),
      row(K.activeNoExpiry, "ACTIVE", null),
      row(K.foreign, "ACTIVE", inDays(10), COMPANY.b),
    ],
  });
});

afterAll(async () => {
  await removeFixtures();
  await cleanupSessions();
  await prisma.$disconnect();
});

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort();

async function section(view: ContractView, params: Record<string, string> = {}) {
  const legal = await loginAs("LEGAL");
  return contracts.listContracts(legal, parseContractQuery({ search: SEARCH, limit: "100", ...params }, { view }));
}

describe("contract sections (AUD-08 §3, DT-02)", () => {
  const expected: Record<ContractView, string[]> = {
    all: [K.draft, K.review, K.active, K.expiring, K.expired, K.terminated, K.activeNoExpiry],
    drafts: [K.draft],
    review: [K.review],
    active: [K.active, K.expiring, K.activeNoExpiry],
    expiring: [K.expiring],
    expired: [K.expired],
    terminated: [K.terminated],
    archived: [K.archived],
  };

  for (const view of Object.keys(expected) as ContractView[]) {
    it(`${view}: exactly its own contracts`, async () => {
      const result = await section(view);
      expect(ids(result.data)).toEqual([...expected[view]].sort());
      expect(result.pagination.total).toBe(expected[view].length);
    });
  }

  it("a section page ignores a `view` or `status` in the address that would step outside it", async () => {
    expect(ids((await section("drafts", { view: "archived" })).data)).toEqual([K.draft]);
    expect(ids((await section("active", { status: "DRAFT" })).data)).toEqual([K.active, K.expiring, K.activeNoExpiry].sort());
    // "All" still offers the Status filter, and it narrows.
    expect(ids((await section("all", { status: "DRAFT,IN_REVIEW" })).data)).toEqual([K.draft, K.review].sort());
  });

  it("the export's address carries the section, so the exported set is the section's", async () => {
    for (const view of ["active", "expiring", "archived", "drafts"] as const) {
      const search = new URLSearchParams(contractSectionSearch({ search: SEARCH, page: "3", status: "DRAFT" }, view));
      expect(search.get("view")).toBe(view);
      expect(search.has("page")).toBe(false);
      // The export route parses the address with no section of its own (AUD-08 §7): same set as the page.
      const legal = await loginAs("LEGAL");
      const exported = await contracts.listContracts(legal, parseContractQuery(search));
      expect(ids(exported.data)).toEqual([...expected[view]].sort());
    }
  });
});

describe("contract sort and pages (AUD-08 §4)", () => {
  it("DT-04: expiry soonest first, no expiry last, equal values broken by id — the same across pages", async () => {
    const legal = await loginAs("LEGAL");
    const read = (page: number) => contracts.listContracts(legal, parseContractQuery({ search: SEARCH, sort: "expiry-asc", limit: "3", page: String(page) }, { view: "all" }));
    const order = [(await read(1)).data, (await read(2)).data, (await read(3)).data].flat().map((row) => row.id);
    // Dated first by expiry; then the undated, by id.
    expect(order).toEqual([K.expired, K.expiring, K.active, K.draft, K.review, K.terminated, K.activeNoExpiry]);
  });

  it("DT-05: a page past the end reads the last page", async () => {
    const legal = await loginAs("LEGAL");
    const result = await contracts.listContracts(legal, parseContractQuery({ search: SEARCH, limit: "3", page: "40" }, { view: "all" }));
    expect(result.pagination).toMatchObject({ page: 3, totalPages: 3, total: 7 });
    expect(result.data).toHaveLength(1);
  });

  it("DT-22: another company's contract is never listed; its own company's legal reader sees it", async () => {
    const all = await section("active");
    expect(all.data.map((row) => row.id)).not.toContain(K.foreign);
    const legalB = await loginAsMembership(OWNER_B);
    const b = await contracts.listContracts(legalB, parseContractQuery({ search: SEARCH }, { view: "active" }));
    expect(b.data.map((row) => row.id)).toEqual([K.foreign]);
  });
});
