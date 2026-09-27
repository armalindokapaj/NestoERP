import { Prisma, type OpportunityStage } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { parseOpportunityQuery } from "@/lib/modules/sales/sales.query";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * AUD-08 on the opportunity list (DT-03, DT-04, DT-05): probability and
 * weighted value are derived, and they used to be applied to the page after it
 * was read — a probability filter shrank a page while the count stayed, and a
 * weighted sort re-ordered 25 rows rather than the list. Both now run before
 * the count and the page.
 *
 * Stage defaults: PROSPECTING 10, QUALIFIED 25, DISCOVERY 40, PROPOSAL 60,
 * NEGOTIATION 80. Every expected order below is worked out from those by hand.
 */

const PREFIX = "aud08c2_opp";
const SEARCH = "AUD08C2-OPP";
const OWNER = "member_sales";

//                      stage         value   override  probability  weighted
const O = {
  one: `${PREFIX}_01`, // PROSPECTING  1000.00   —          10          100.00
  two: `${PREFIX}_02`, // NEGOTIATION   200.00   —          80          160.00
  three: `${PREFIX}_03`, // QUALIFIED   100.00   90         90           90.00
  four: `${PREFIX}_04`, // PROPOSAL     500.00   —          60          300.00
  five: `${PREFIX}_05`, // DISCOVERY    250.00   —          40          100.00 (ties `one`)
};

beforeAll(async () => {
  await prisma.opportunity.deleteMany({ where: { id: { startsWith: PREFIX } } });
  const row = (id: string, stage: OpportunityStage, value: string, override: string | null = null) => ({
    id,
    companyId: COMPANY.a,
    name: `${SEARCH} ${id.slice(-2)}`,
    stage,
    estimatedValue: new Prisma.Decimal(value),
    probabilityOverride: override === null ? null : new Prisma.Decimal(override),
    currency: "EUR",
    ownerMemberId: OWNER,
    createdByMemberId: OWNER,
  });
  await prisma.opportunity.createMany({
    data: [row(O.one, "PROSPECTING", "1000.00"), row(O.two, "NEGOTIATION", "200.00"), row(O.three, "QUALIFIED", "100.00", "90"), row(O.four, "PROPOSAL", "500.00"), row(O.five, "DISCOVERY", "250.00")],
  });
});

afterAll(async () => {
  await prisma.opportunity.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

async function list(params: Record<string, string>) {
  const sales = await loginAs("SALES");
  return opportunities.listOpportunities(sales, parseOpportunityQuery(new URLSearchParams({ search: SEARCH, ...params })));
}

describe("derived opportunity sorts and filters (AUD-08 §3, §4)", () => {
  it("DT-04: weighted value, highest first over the whole list, a tie broken by the estimate, then the id", async () => {
    const pages = [await list({ sort: "weighted-desc", limit: "2" }), await list({ sort: "weighted-desc", limit: "2", page: "2" }), await list({ sort: "weighted-desc", limit: "2", page: "3" })];
    expect(pages.map((page) => page.data.map((row) => row.id))).toEqual([[O.four, O.two], [O.one, O.five], [O.three]]);
    expect(pages.every((page) => page.pagination.total === 5)).toBe(true);
  });

  it("DT-04: probability (the override when set) highest first", async () => {
    const result = await list({ sort: "probability-desc", limit: "10" });
    expect(result.data.map((row) => row.id)).toEqual([O.three, O.two, O.four, O.five, O.one]);
  });

  it("DT-03: a probability floor is applied before the count and the page", async () => {
    const first = await list({ minProbability: "40", sort: "name-asc", limit: "3" });
    // 90 (override), 80, 60, 40 — the QUALIFIED deal passes on its override, not its stage's 25.
    expect(first.pagination.total).toBe(4);
    expect(first.data.map((row) => row.id)).toEqual([O.two, O.three, O.four]);
    const second = await list({ minProbability: "40", sort: "name-asc", limit: "3", page: "2" });
    expect(second.data.map((row) => row.id)).toEqual([O.five]);
  });

  it("DT-03: a probability ceiling uses the override too, and combines (AND) with a value floor", async () => {
    expect((await list({ maxProbability: "30" })).data.map((row) => row.id)).toEqual([O.one]);
    const both = await list({ maxProbability: "90", minValue: "200", sort: "name-asc" });
    expect(both.data.map((row) => row.id)).toEqual([O.one, O.two, O.four, O.five]);
    expect(both.pagination.total).toBe(4);
  });

  it("DT-05: a page past the end of a derived sort reads the last page", async () => {
    const past = await list({ sort: "weighted-desc", limit: "2", page: "7" });
    expect(past.pagination).toMatchObject({ page: 3, totalPages: 3, total: 5 });
    expect(past.data.map((row) => row.id)).toEqual([O.three]);
  });
});
