import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let urlQuery = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(urlQuery),
  usePathname: () => "/clients",
}));

import { DataTable, columnMetaOf, type TableColumn } from "@/components/data/data-table";
import { Pagination } from "@/components/data/pagination";
import { pageWindow, skipFor, sortNulls, withTieBreaker } from "@/lib/modules/shared/list-query";
import { COMPANY, prisma } from "../../helpers";

/**
 * AUD-08 shared table contracts against the real database and the real
 * components (§4, §5; DT-04, DT-05, DT-08, DT-19).
 *
 * Seven clients in Aurelia share one name and one `updatedAt`; three have no
 * code, and the codes that exist carry leading zeros. The expected orders are
 * written out by hand from the fixture — never read back from a list service.
 */

/** The file is `.ts` (the suite's include pattern), so elements are built without JSX. */
const table = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(DataTable, { rowKey: (row: Row) => row.id, records: ROWS, ...props } as never));
const pagination = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Pagination, props as never));

const PREFIX = "aud08a_";
const ID = (n: number) => `${PREFIX}c0${n}`;
const TIED_AT = new Date("2026-09-01T08:00:00.000Z");
const CODES: Record<number, string | null> = {
  1: "AUD08A-010",
  2: null,
  3: "AUD08A-007",
  4: null,
  5: "AUD08A-0100",
  6: "AUD08A-001",
  7: null,
};

async function cleanup() {
  await prisma.client.deleteMany({ where: { companyId: COMPANY.a, id: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "owner@nesto.test" }, select: { id: true } });
  // Created out of id order, so insertion order cannot pass for the tie-breaker.
  for (const n of [5, 2, 7, 1, 4, 6, 3]) {
    await prisma.client.create({
      data: {
        id: ID(n),
        companyId: COMPANY.a,
        name: `${PREFIX}tied`,
        code: CODES[n],
        createdBy: owner.id,
        createdAt: TIED_AT,
        updatedAt: TIED_AT,
      },
    });
  }
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const where = { companyId: COMPANY.a, id: { startsWith: PREFIX } };

async function pages(orderBy: Parameters<typeof withTieBreaker>[0], limit: number): Promise<string[][]> {
  const total = await prisma.client.count({ where });
  const { totalPages } = pageWindow(total, 1, limit);
  const result: string[][] = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const rows = await prisma.client.findMany({
      where,
      orderBy: withTieBreaker(orderBy) as never,
      skip: skipFor(page, limit),
      take: limit,
      select: { id: true },
    });
    result.push(rows.map((row) => row.id));
  }
  return result;
}

describe("DT-04: equal primary values page deterministically with the tie-breaker", () => {
  it("orders seven tied names by id across pages of three, with no repeat and no gap", async () => {
    expect(await pages({ name: "asc" }, 3)).toEqual([
      [ID(1), ID(2), ID(3)],
      [ID(4), ID(5), ID(6)],
      [ID(7)],
    ]);
  });

  it("orders tied timestamps the same way descending", async () => {
    expect((await pages({ updatedAt: "desc" }, 2)).flat()).toEqual([ID(1), ID(2), ID(3), ID(4), ID(5), ID(6), ID(7)]);
  });

  it("puts null codes last ascending and first descending, as stated, tied by id", async () => {
    expect((await pages({ code: sortNulls("asc", "last") }, 3)).flat()).toEqual([ID(6), ID(3), ID(1), ID(5), ID(2), ID(4), ID(7)]);
    expect((await pages({ code: sortNulls("desc", "first") }, 3)).flat()).toEqual([ID(2), ID(4), ID(7), ID(5), ID(1), ID(3), ID(6)]);
  });

  it("counts the matching rows, not the page", async () => {
    const total = await prisma.client.count({ where });
    expect(total).toBe(7);
    expect(pageWindow(total, 3, 3)).toMatchObject({ from: 7, to: 7, totalPages: 3, outOfRange: false });
    expect(pageWindow(total, 4, 3)).toMatchObject({ page: 3, outOfRange: true });
  });
});

type Row = { id: string; name: string; code: string | null; status: string; notes: string };
const ROWS: Row[] = [
  { id: "r1", name: "Alpha", code: "007", status: "ACTIVE", notes: "n1" },
  { id: "r2", name: "Beta", code: null, status: "INACTIVE", notes: "n2" },
];

const COLUMNS: TableColumn<Row>[] = [
  { key: "name", label: "Name", primary: true, render: (row) => row.name },
  { key: "code", label: "Code", render: (row) => row.code ?? "—" },
  { key: "status", label: "Status", valueType: "status", render: (row) => row.status },
  { key: "notes", id: "internal-notes", label: "Notes", defaultHidden: true, render: (row) => row.notes },
];

describe("DataTable without a list id renders as before AUD-08", () => {
  it("has no column ids, scope, Columns control or sort controls", () => {
    const html = table({ columns: COLUMNS, caption: "Clients" });
    expect(html).not.toContain("data-col-id");
    expect(html).not.toContain("data-table-scope");
    expect(html).not.toContain("aria-sort");
    expect(html).not.toContain(">Columns<");
    // Every column, header and cell alike, is drawn.
    for (const text of ["Name", "Code", "Status", "Notes", "Alpha", "007", "INACTIVE", "n2"]) expect(html).toContain(text);
  });
});

describe("DT-08: DataTable with a list id", () => {
  it("derives the column metadata: primary mandatory, ids default to keys, default-hidden kept", () => {
    expect(columnMetaOf(COLUMNS)).toEqual([
      { id: "name", label: "Name", mandatory: true, defaultHidden: false },
      { id: "code", label: "Code", mandatory: false, defaultHidden: false },
      { id: "status", label: "Status", mandatory: false, defaultHidden: false, valueType: "status" },
      { id: "internal-notes", label: "Notes", mandatory: false, defaultHidden: true },
    ]);
  });

  it("marks optional cells, applies the defaults on first render and offers the Columns control", () => {
    const html = table({ listId: "clients.all", columns: COLUMNS, caption: "Clients" });
    expect(html).toContain('data-list-id="clients.all"');
    expect(html).toContain('data-hidden-columns="internal-notes"');
    expect(html).toMatch(/\[data-table-scope="[^"]+"\] \[data-col-id="internal-notes"\]\{display:none\}/);
    expect(html).toContain('data-col-id="code"');
    // The primary column is never hideable: its cells carry no column id.
    expect(html).not.toContain('data-col-id="name"');
    expect(html).toContain("Columns");
    // Status stays on the mobile card: only the two table cells and the header carry its id.
    expect(html.match(/data-col-id="status"/g)?.length).toBe(1 + ROWS.length);
    expect(html.match(/data-col-id="code"/g)?.length).toBe(1 + ROWS.length * 2);
  });
});

describe("DT-04 / DT-19: header sort controls announce the applied sort", () => {
  const sortable: TableColumn<Row>[] = [
    { key: "name", label: "Name", primary: true, sortKey: "name", render: (row) => row.name },
    { key: "code", label: "Code", sortKey: "code", render: (row) => row.code ?? "—" },
    { key: "status", label: "Status", render: (row) => row.status },
  ];
  const keys = ["updated-desc", "name-asc", "name-desc", "code-asc"] as const;

  it("uses the server-parsed sort over the URL", () => {
    urlQuery = "sort=code-asc";
    const html = table({ columns: sortable, sort: { value: "name-desc", keys } });
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*data-sort-key="name"/);
    expect(html).toMatch(/<th[^>]*aria-sort="none"[^>]*data-sort-key="code"/);
    // An unsortable column has no aria-sort.
    expect(html.match(/aria-sort=/g)?.length).toBe(2);
  });

  it("falls back to an allowlisted URL value, then to the default", () => {
    urlQuery = "sort=code-asc";
    let html = table({ columns: sortable, sort: { keys, defaultValue: "updated-desc" } });
    expect(html).toMatch(/<th[^>]*aria-sort="ascending"[^>]*data-sort-key="code"/);
    urlQuery = "sort=salary-desc";
    html = table({ columns: sortable, sort: { keys, defaultValue: "updated-desc" } });
    expect(html).not.toMatch(/aria-sort="(ascending|descending)"/);
    urlQuery = "";
  });
});

describe("DT-05: pagination counts", () => {
  it("says 0 results, never 1–0, and draws no navigation", () => {
    const html = pagination({ meta: { page: 1, limit: 25, total: 0, totalPages: 1 }, searchParams: {} });
    expect(html).toContain("<span class=\"tabular-nums\">0</span> results");
    expect(html).not.toContain("1–0");
    expect(html).not.toContain('aria-label="Pagination"');
  });

  it("keeps a count on a single page", () => {
    const html = pagination({ meta: { page: 1, limit: 25, total: 7, totalPages: 1 }, searchParams: {} });
    expect(html).toContain("1–7");
    expect(html).toMatch(/of <span class="tabular-nums">7<\/span>/);
    expect(html).not.toContain('aria-label="Pagination"');
  });

  it("shows 1–25 of 73 with links that keep every other key", () => {
    const html = pagination({
      meta: { page: 2, limit: 25, total: 73, totalPages: 3 },
      basePath: "/finance/invoices",
      searchParams: { search: "roof", status: ["OPEN", "DRAFT"], section: "mine", sort: "due-asc", page: "2" },
    });
    expect(html).toContain("26–50");
    expect(html).toContain('aria-label="Pagination"');
    expect(html).toContain('href="/finance/invoices?search=roof&amp;status=OPEN&amp;status=DRAFT&amp;section=mine&amp;sort=due-asc"');
    expect(html).toContain('href="/finance/invoices?search=roof&amp;status=OPEN&amp;status=DRAFT&amp;section=mine&amp;sort=due-asc&amp;page=3"');
  });

  it("still honours a caller's own buildHref", () => {
    const html = pagination({ meta: { page: 1, limit: 10, total: 30, totalPages: 3 }, buildHref: (page: number) => `/audit?page=${page}` });
    expect(html).toContain('href="/audit?page=2"');
    expect(html).toContain("1–10");
  });
});
