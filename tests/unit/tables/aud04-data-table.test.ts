import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let urlQuery = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(urlQuery),
  usePathname: () => "/finance/invoices",
}));

import { DataTable, columnMetaOf, type TableColumn } from "@/components/data/data-table";
import { ListToolbar } from "@/components/data/list-toolbar";

/**
 * AUD-04 §5 (MW-05, MW-06): what the one table and the list toolbar draw for
 * phones and tablets, rendered on the server exactly as a page does. One
 * render serves every width; these assertions read the markup CSS switches.
 */

type Row = { id: string; number: string; project: string; due: string; total: string; status: string };
const ROWS: Row[] = [
  { id: "r1", number: "INV-2026-000000000000000001", project: "North tower", due: "2026-10-01", total: "1,234,567.89 EUR", status: "Open" },
];

const COLUMNS: TableColumn<Row>[] = [
  { key: "number", label: "Invoice", primary: true, sortKey: "number", render: (row) => React.createElement("span", { className: "block truncate" }, row.number) },
  { key: "project", label: "Project", hideBelow: "xl", render: (row) => row.project },
  { key: "due", label: "Due", valueType: "date", sortKey: "due", hideBelow: "lg", render: (row) => row.due },
  { key: "total", label: "Total", valueType: "money", align: "right", sortKey: "amount", hideBelow: "lg", render: (row) => row.total },
  { key: "status", label: "Status", valueType: "status", render: (row) => row.status },
];

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    React.createElement(DataTable, { rowKey: (row: Row) => row.id, records: ROWS, columns: COLUMNS, caption: "Invoices", ...props } as never),
  );
const menu = () => React.createElement("button", { type: "button", "aria-label": "More actions for INV-1" }, "…");

describe("cards", () => {
  it("stretch the title link over the card, with a chevron, and never nest the actions in it", () => {
    const html = render({ rowHref: (row: Row) => `/finance/invoices/${row.id}`, actions: menu });
    const card = html.slice(html.indexOf("data-record-card"));
    expect(card).toMatch(/<a[^>]*data-card-link[^>]*class="[^"]*after:absolute after:inset-0/);
    expect(card).toContain("lucide-chevron-right");
    // Actions: their own row, above the stretched link, outside the anchor.
    expect(card).toMatch(/data-card-actions[^>]*class="relative z-10 /);
    const anchor = card.slice(card.indexOf("<a"), card.indexOf("</a>"));
    expect(anchor).not.toContain("<button");
    // Links and buttons inside the values sit above the stretched link too.
    expect(card).toContain("[&amp;_a]:relative [&amp;_a]:z-10 [&amp;_button]:relative [&amp;_button]:z-10");
  });

  it("wrap long codes on the card, but never break an amount", () => {
    const html = render({ rowHref: (row: Row) => `/finance/invoices/${row.id}` });
    const card = html.slice(html.indexOf("data-record-card"));
    expect(card).toContain("[overflow-wrap:anywhere] [&amp;_.truncate]:overflow-visible [&amp;_.truncate]:whitespace-normal");
    expect(card).toMatch(/<dd class="min-w-0 text-fg-muted tabular-nums">1,234,567.89 EUR<\/dd>/);
  });

  it("have no stretched link or chevron without a row link", () => {
    const html = render({});
    expect(html).not.toContain("data-card-link");
    expect(html).not.toContain("lucide-chevron-right");
  });
});

describe("tablet columns", () => {
  it("never hide a money column by width; other columns keep their breakpoint", () => {
    const html = render({ listId: "finance.invoices" });
    expect(html).toMatch(/<th[^>]*class="[^"]*hidden xl:table-cell"[^>]*data-col-id="project"/);
    expect(html).toMatch(/<td[^>]*class="[^"]*hidden lg:table-cell"[^>]*data-col-id="due"/);
    expect(html).not.toMatch(/data-col-id="total"[^>]*class="[^"]*hidden/);
    expect(html).not.toMatch(/class="[^"]*hidden lg:table-cell[^"]*"[^>]*data-col-id="total"/);
    // Figure cells are read whole: the table scrolls instead.
    expect(html).toMatch(/<td[^>]*class="[^"]*text-right tabular-nums whitespace-nowrap/);
  });

  it("tells the Columns control which columns have a breakpoint (never a figure)", () => {
    expect(columnMetaOf(COLUMNS).map((column) => [column.id, column.hideBelow])).toEqual([
      ["number", undefined],
      ["project", "xl"],
      ["due", "lg"],
      ["total", undefined],
      ["status", undefined],
    ]);
  });

  it("without a Columns control, a width-hidden column is a line under the title while hidden", () => {
    const html = render({});
    expect(html).toMatch(/data-width-line="project" class="[^"]*xl:hidden">Project: North tower/);
    expect(html).toMatch(/data-width-line="due" class="[^"]*lg:hidden">Due: 2026-10-01/);
    expect(html).not.toContain('data-width-line="total"');
    expect(render({ listId: "finance.invoices" })).not.toContain("data-width-line");
  });
});

describe("phone Sort (MW-06)", () => {
  it("offers the header orders as a labelled select with the applied one selected", () => {
    urlQuery = "";
    const html = render({ listId: "finance.invoices", sort: { value: "due-asc", keys: ["number-asc", "due-asc", "due-desc", "amount-desc"] } });
    expect(html).toContain("data-table-sort");
    expect(html).toMatch(/<label[^>]*>Sort<\/label>/);
    expect(html).toContain('aria-label="Sort Invoices"');
    expect(html).toMatch(/<option value="due-asc" selected="">Due: earliest first<\/option>/);
    expect(html).toContain('<option value="amount-desc">Total: highest first</option>');
    expect(html).not.toContain("amount-asc");
    // It steps aside where the page's toolbar offers Sort.
    expect(html).toContain("[:root:has([data-list-sort-control])_&amp;]:hidden");
  });

  it("shows 'List order' when the applied sort is none of the columns'", () => {
    const html = render({ sort: { value: "recent", keys: ["recent", "due-asc"] } });
    expect(html).toMatch(/<option value="" selected="">List order<\/option>/);
  });

  it("is absent where nothing is sortable", () => {
    expect(render({ columns: COLUMNS.map((column) => ({ ...column, sortKey: undefined })) })).not.toContain("data-table-sort");
  });
});

describe("list toolbar on phones (MW-06)", () => {
  const filters = [
    { param: "status", label: "Status", options: [{ value: "OPEN", label: "Open" }, { value: "PAID", label: "Paid" }] },
    { param: "projectId", label: "Project", options: [{ value: "p1", label: "North tower" }] },
  ];
  const toolbar = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(React.createElement(ListToolbar, { filters, sortOptions: [{ value: "due-asc", label: "Due soonest" }], ...props } as never));

  it("shows a labelled Sort beside a Filters button whose badge counts the applied filters", () => {
    urlQuery = "status=OPEN&search=roof&sort=due-asc";
    const html = toolbar();
    expect(html).toContain("data-list-sort-control");
    expect(html).toMatch(/data-filter-sheet-trigger[^>]*>[\s\S]*Filters[\s\S]*>1<\/span><span class="sr-only">, 1 applied<\/span>/);
    // Removable chips and Clear all, outside the sheet.
    expect(html).toContain('aria-label="Remove filter Status: Open"');
    expect(html).toContain(">Clear all</button>");
    // The sheet itself is not rendered until opened.
    expect(html).not.toContain('data-testid="filter-sheet"');
  });

  it("counts only what was applied: a value no option offers is neither a chip nor a count", () => {
    urlQuery = "status=BOGUS";
    const html = toolbar();
    expect(html).not.toContain("Remove filter");
    expect(html).not.toContain("applied</span>");
    // It can still be cleared.
    expect(html).toContain(">Clear all</button>");
    urlQuery = "";
  });

  it("has no chips row when nothing is applied", () => {
    urlQuery = "";
    expect(toolbar()).not.toContain("data-filter-chips");
  });
});
