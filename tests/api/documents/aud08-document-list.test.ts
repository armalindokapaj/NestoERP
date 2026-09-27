import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { prisma as appPrisma } from "@/lib/database/prisma";
import { parseDocumentListQuery, type DocumentQueryDefaults } from "@/lib/modules/documents/document.query";
import * as documents from "@/lib/modules/documents/document.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * AUD-08 — the Documents list's query contract (§3, §4; DT-02..DT-05, DT-22).
 *
 * Aurelia's timezone is Europe/Tirane (UTC+2 in September). Expected ids are
 * written out from this table, never read back from the list (PRD §9):
 *
 * | id | name  | size | created (UTC)          | Tirane day | other      |
 * |----|-------|------|------------------------|------------|------------|
 * | d1 | a     | 100  | 2020-09-15 21:30       | 15th       |            |
 * | d2 | a     | 100  | 2020-09-15 22:30       | 16th       |            |
 * | d3 | b     | —    | 2020-09-14 22:00       | 15th 00:00 |            |
 * | d4 | c     | 50   | 2020-09-14 21:59:59    | 14th       |            |
 * | d5 | d     | 10   | 2026-01-01             |            | archived   |
 * | d6 | e     | 10   | 2026-01-01             |            | company B  |
 * | d7 | f     | 10   | 2026-01-01             |            | project A  |
 */

const TAG = "aud08c-DL";
const id = (n: number) => `aud08c_doc_${n}`;
const d = { d1: id(1), d2: id(2), d3: id(3), d4: id(4), d5: id(5), d6: id(6), d7: id(7) };
const ALL = Object.values(d);

let owner: UserContext;

const list = (params: Record<string, string>, defaults: DocumentQueryDefaults = {}) =>
  documents.listDocuments(owner, parseDocumentListQuery({ search: TAG, ...params }, defaults));
const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

async function walk(sort: string, limit = 2) {
  const seen: string[] = [];
  const totals = new Set<number>();
  for (let page = 1; page < 20; page += 1) {
    const result = await list({ sort, limit: String(limit), page: String(page) });
    totals.add(result.pagination.total);
    seen.push(...ids(result.data));
    if (page >= result.pagination.totalPages) break;
  }
  return { seen, totals: [...totals] };
}

beforeAll(async () => {
  await prisma.document.deleteMany({ where: { id: { in: ALL } } });
  owner = await loginAs("OWNER");
  const make = (key: keyof typeof d, label: string, extra: { companyId?: string; size?: number | null; createdAt: string; archived?: boolean; projectId?: string }) =>
    prisma.document.create({
      data: {
        id: d[key],
        companyId: extra.companyId ?? COMPANY.a,
        name: `${TAG} ${label}`,
        originalFileName: `${label}.pdf`,
        extension: "pdf",
        mimeType: "application/pdf",
        sizeBytes: extra.size === null ? null : BigInt(extra.size ?? 10),
        status: extra.archived ? "ARCHIVED" : "ACTIVE",
        archivedAt: extra.archived ? new Date("2026-01-02T00:00:00.000Z") : null,
        storageStatus: "AVAILABLE",
        projectId: extra.projectId ?? null,
        createdBy: "aud08c-document-list-test",
        createdAt: new Date(extra.createdAt),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  await make("d1", "a", { size: 100, createdAt: "2020-09-15T21:30:00.000Z" });
  await make("d2", "a", { size: 100, createdAt: "2020-09-15T22:30:00.000Z" });
  await make("d3", "b", { size: null, createdAt: "2020-09-14T22:00:00.000Z" });
  await make("d4", "c", { size: 50, createdAt: "2020-09-14T21:59:59.000Z" });
  await make("d5", "d", { createdAt: "2026-01-01T00:00:00.000Z", archived: true });
  await make("d6", "e", { createdAt: "2026-01-01T00:00:00.000Z", companyId: COMPANY.b });
  await make("d7", "f", { createdAt: "2026-01-01T00:00:00.000Z", projectId: PROJECT.a });
}, 60_000);

afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: { in: ALL } } });
  await cleanupSessions();
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

describe("DT-04 — every sort is a total order, identical across pages", () => {
  // Live documents in Aurelia with the tag: d1 d2 d3 d4 d7.
  it.each([
    ["name-asc", [d.d1, d.d2, d.d3, d.d4, d.d7]],
    // Equal names fall to the id ascending in both directions.
    ["name-desc", [d.d7, d.d4, d.d3, d.d1, d.d2]],
    // A file without a recorded size sorts last in both directions.
    ["size-desc", [d.d1, d.d2, d.d4, d.d7, d.d3]],
    ["size-asc", [d.d7, d.d4, d.d1, d.d2, d.d3]],
    // Identical updatedAt everywhere: the id alone decides.
    ["updated-desc", [d.d1, d.d2, d.d3, d.d4, d.d7]],
  ])("%s", async (sort, expected) => {
    const { seen, totals } = await walk(sort as string);
    expect(seen).toEqual(expected);
    expect(totals).toEqual([5]);
  });
});

describe("DT-03 — upload dates are calendar days in the company's timezone, inclusive", () => {
  it("dateFrom = dateTo = the 15th: Tirane's whole 15th, and nothing of the 14th or 16th", async () => {
    const result = await list({ dateFrom: "2020-09-15", dateTo: "2020-09-15", sort: "name-asc" });
    expect(ids(result.data)).toEqual([d.d1, d.d3]);
    expect(result.pagination.total).toBe(2);
  });

  it("open-ended ranges", async () => {
    expect(ids((await list({ dateTo: "2020-09-14", sort: "name-asc" })).data)).toEqual([d.d4]);
    expect(ids((await list({ dateFrom: "2020-09-16", sort: "name-asc" })).data)).toEqual([d.d2, d.d7]);
  });

  it("date AND project AND search combine; the count is taken before pagination", async () => {
    expect((await list({ dateFrom: "2020-01-01", projectId: PROJECT.a })).pagination.total).toBe(1);
    const page = await list({ dateFrom: "2020-09-14", dateTo: "2020-09-16", sort: "name-asc", limit: "1" });
    expect(ids(page.data)).toEqual([d.d1]);
    expect(page.pagination.total).toBe(4);
  });
});

describe("DT-02 — sections", () => {
  it("Archived answers only archived documents; the live list never does", async () => {
    expect(ids((await list({}, { archived: true })).data)).toEqual([d.d5]);
    expect(ids((await list({ sort: "name-asc" })).data)).not.toContain(d.d5);
  });
});

describe("DT-05 — out-of-range and empty", () => {
  it("clamps a page past the end to the last page; an empty list is page 1 of 1", async () => {
    const past = await list({ sort: "name-asc", limit: "2", page: "9" });
    expect(past.pagination).toMatchObject({ page: 3, totalPages: 3, total: 5 });
    const empty = await documents.listDocuments(owner, parseDocumentListQuery({ search: "aud08c-no-such-document", page: "4" }));
    expect(empty.pagination).toMatchObject({ page: 1, totalPages: 1, total: 0 });
  });
});

describe("DT-22 — foreign ids narrow to nothing", () => {
  it("another company's project or client yields no rows; their own project does", async () => {
    expect((await list({ projectId: PROJECT.b })).pagination.total).toBe(0);
    const foreignClient = await prisma.client.findFirst({ where: { companyId: COMPANY.b }, select: { id: true } });
    if (foreignClient) expect((await list({ clientId: foreignClient.id })).pagination.total).toBe(0);
    expect(ids((await list({ projectId: PROJECT.a })).data)).toEqual([d.d7]);
    expect(ids((await list({ search: `${TAG} e` })).data)).toEqual([]);
  });
});
