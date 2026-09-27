import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { feedQuerySchema } from "@/lib/modules/announcements/announcement.schema";
import { listAnnouncements } from "@/lib/modules/announcements/announcement.service";
import { cleanupSessions, COMPANY, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * AUD-08 §3, §4 on the announcement feed and its Manage tab, against the real
 * database (DT-02, DT-04, DT-05, DT-22): the feed's "Load more" slices walk
 * the documented order exactly once, and `total` counts every match rather
 * than the loaded cards. Expected ids are written from the fixtures below.
 */

const TIED_EDIT = new Date("2026-02-01T10:00:00.000Z");
const PUBLISHED = new Date("2026-02-02T10:00:00.000Z");
/** Four drafts edited at one instant: only the id orders them (descending, the feed's tie-breaker). */
const DRAFTS = ["aud08e_an_d1", "aud08e_an_d2", "aud08e_an_d3", "aud08e_an_d4"];
const PUBLISHED_IDS = ["aud08e_an_p1", "aud08e_an_p2"];
const EXPIRED = "aud08e_an_x1";
/** A draft to one project, edited before everything else. */
const ON_PROJECT = "aud08e_an_proj";

let owner: UserContext;

async function cleanup() {
  await prisma.announcement.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
}

beforeAll(async () => {
  await cleanup();
  owner = await loginAs("OWNER");
  const base = (id: string) => ({ id, companyId: COMPANY.a, title: `AUD08E-AN ${id}`, body: "AUD-08 feed probe.", authorMemberId: owner.membershipId, audienceType: "COMPANY" as const });
  await prisma.announcement.createMany({
    data: [
      ...DRAFTS.map((id) => ({ ...base(id), status: "DRAFT" as const, updatedAt: TIED_EDIT })),
      ...PUBLISHED_IDS.map((id) => ({ ...base(id), status: "PUBLISHED" as const, publishedAt: PUBLISHED, updatedAt: new Date("2026-01-01T00:00:00.000Z") })),
      { ...base(EXPIRED), status: "EXPIRED" as const, publishedAt: new Date("2026-01-15T00:00:00.000Z"), expiredAt: new Date("2026-01-20T00:00:00.000Z"), updatedAt: new Date("2025-12-01T00:00:00.000Z") },
      { ...base(ON_PROJECT), audienceType: "PROJECT" as const, projectId: PROJECT.a, status: "DRAFT" as const, updatedAt: new Date("2025-11-01T00:00:00.000Z") },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
});

/** Every card of a tab, following `nextCursor` two at a time. */
async function walk(extra: Record<string, unknown>): Promise<{ ids: string[]; totals: number[] }> {
  const ids: string[] = [];
  const totals: number[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 10; guard += 1) {
    const feed = await listAnnouncements(owner, feedQuerySchema.parse({ q: "AUD08E-AN", limit: 2, ...extra, ...(cursor ? { cursor } : {}) }));
    ids.push(...feed.items.map((item) => item.id));
    totals.push(feed.total);
    if (!feed.nextCursor) break;
    cursor = feed.nextCursor;
  }
  return { ids, totals };
}

describe("announcement feed (AUD-08 §3, §4)", () => {
  it("DT-04: Manage walks last-edited first, ties by id, each card once; total is every match", async () => {
    const { ids, totals } = await walk({ tab: "manage" });
    expect(ids).toEqual(["aud08e_an_d4", "aud08e_an_d3", "aud08e_an_d2", "aud08e_an_d1", "aud08e_an_p2", "aud08e_an_p1", EXPIRED, ON_PROJECT]);
    expect(new Set(totals)).toEqual(new Set([8]));
  });

  it("DT-02, DT-03: History keeps its section (published and expired only) and filters combine", async () => {
    const { ids, totals } = await walk({ tab: "history" });
    expect(ids).toEqual(["aud08e_an_p2", "aud08e_an_p1", EXPIRED]);
    expect(totals[0]).toBe(3);
    const drafts = await listAnnouncements(owner, feedQuerySchema.parse({ tab: "manage", q: "AUD08E-AN", status: "DRAFT", limit: 100 }));
    expect(drafts.total).toBe(5);
    expect(drafts.items.map((item) => item.id)).toEqual(["aud08e_an_d4", "aud08e_an_d3", "aud08e_an_d2", "aud08e_an_d1", ON_PROJECT]);
  });

  it("DT-05: a cursor past the end answers no cards and no next cursor, with the true total", async () => {
    const past = await listAnnouncements(owner, feedQuerySchema.parse({ tab: "manage", q: "AUD08E-AN", cursor: "40" }));
    expect(past).toMatchObject({ items: [], nextCursor: null, total: 8 });
  });

  it("DT-22: a project the reader cannot open narrows to nothing; their own project answers", async () => {
    const own = await listAnnouncements(owner, feedQuerySchema.parse({ tab: "manage", q: "AUD08E-AN", projectId: PROJECT.a }));
    expect(own.items.map((item) => item.id)).toEqual([ON_PROJECT]);
    const foreign = await listAnnouncements(owner, feedQuerySchema.parse({ tab: "manage", q: "AUD08E-AN", projectId: PROJECT.companyB }));
    expect(foreign.total).toBe(0);
    expect(foreign.items).toEqual([]);
  });
});
