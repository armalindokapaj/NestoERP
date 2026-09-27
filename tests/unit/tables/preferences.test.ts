import { describe, expect, it } from "vitest";

import type { ColumnMeta } from "@/lib/tables/columns";
import {
  TABLE_PREFERENCES_VERSION,
  columnChoices,
  effectivePageSize,
  parseTablePreferences,
  readTablePreferences,
  resolveHiddenColumns,
  resolvePageSize,
  tablePreferenceKey,
  writeTablePreferences,
  type PreferenceStorage,
} from "@/lib/tables/preferences";

/**
 * DT-08 / DT-09: the local column-preference store (AUD-08 §5). Expected
 * hidden-column sets are written out by hand from the column fixture below.
 */

const COLUMNS: ColumnMeta[] = [
  { id: "number", label: "Number", mandatory: true, defaultHidden: false },
  { id: "client", label: "Client", mandatory: false, defaultHidden: false },
  { id: "status", label: "Status", mandatory: false, defaultHidden: false, valueType: "status" },
  { id: "due", label: "Due", mandatory: false, defaultHidden: false, valueType: "date" },
  { id: "notes", label: "Notes", mandatory: false, defaultHidden: true },
];

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const throwing: PreferenceStorage = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("quota", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
};

const ALICE = { user: "u_alice", workspace: "COMPANY:c1" };
const KEY = "nesto.table.v1:u_alice:COMPANY:c1:finance.invoices";

describe("the preference key names the person, the workspace and the list", () => {
  it("builds nesto.table.v1:<user>:<workspace>:<list>", () => {
    expect(tablePreferenceKey(ALICE, "finance.invoices")).toBe(KEY);
  });

  it("differs per user, per workspace and per list", () => {
    const keys = new Set([
      tablePreferenceKey(ALICE, "finance.invoices"),
      tablePreferenceKey({ user: "u_bob", workspace: "COMPANY:c1" }, "finance.invoices"),
      tablePreferenceKey({ user: "u_alice", workspace: "COMPANY:c2" }, "finance.invoices"),
      tablePreferenceKey({ user: "u_alice", workspace: "GROUP:g1" }, "finance.invoices"),
      tablePreferenceKey(ALICE, "finance.payments"),
    ]);
    expect(keys.size).toBe(5);
  });

  it("stores nothing without an identity or with an unusable list id", () => {
    expect(tablePreferenceKey(null, "finance.invoices")).toBeNull();
    expect(tablePreferenceKey({ user: "", workspace: "COMPANY:c1" }, "finance.invoices")).toBeNull();
    expect(tablePreferenceKey({ user: "u_alice", workspace: " " }, "finance.invoices")).toBeNull();
    expect(tablePreferenceKey(ALICE, "invoices")).toBeNull();
    expect(tablePreferenceKey(ALICE, "Finance.Invoices")).toBeNull();
    expect(tablePreferenceKey(ALICE, "finance.invoices:x")).toBeNull();
  });
});

describe("reading stored preferences never trusts the stored bytes", () => {
  it("reads corrupt JSON, wrong versions and wrong shapes as no preference", () => {
    for (const raw of [
      "{",
      "null",
      "[]",
      "42",
      '"text"',
      JSON.stringify({ columns: { client: false } }),
      JSON.stringify({ v: 2, columns: { client: false } }),
      JSON.stringify({ v: "1", columns: { client: false } }),
      "x".repeat(5000),
    ]) {
      expect(parseTablePreferences(raw)).toBeNull();
    }
    expect(parseTablePreferences(null)).toBeNull();
    expect(parseTablePreferences("")).toBeNull();
  });

  it("keeps only boolean choices under well-formed ids, and only a sane page size", () => {
    const parsed = parseTablePreferences(
      JSON.stringify({
        v: 1,
        columns: { client: false, notes: true, due: "no", '"]{}*{display:block': false, "": false },
        pageSize: 5000,
        amount: "1,234.00",
      }),
    );
    expect(parsed).toEqual({ v: 1, columns: { client: false, notes: true } });
    expect(parseTablePreferences(JSON.stringify({ v: 1, columns: [], pageSize: 50 }))).toEqual({ v: 1, columns: {}, pageSize: 50 });
    expect(parseTablePreferences(JSON.stringify({ v: 1, columns: {}, pageSize: 2.5 }))).toEqual({ v: 1, columns: {} });
  });

  it("falls back to no preference when storage throws, and refuses the write without throwing", () => {
    expect(readTablePreferences(throwing, KEY)).toBeNull();
    expect(writeTablePreferences(throwing, KEY, { v: 1, columns: { client: false } })).toBe(false);
    expect(readTablePreferences(null, KEY)).toBeNull();
    expect(writeTablePreferences(null, KEY, { v: 1, columns: { client: false } })).toBe(false);
    expect(writeTablePreferences(memoryStorage(), null, { v: 1, columns: { client: false } })).toBe(false);
  });
});

describe("resolving stored choices against today's columns", () => {
  it("applies the defaults when nothing is stored", () => {
    expect(resolveHiddenColumns(COLUMNS, null)).toEqual(["notes"]);
  });

  it("discards removed and unknown column ids", () => {
    const stored = { v: TABLE_PREFERENCES_VERSION, columns: { retired: false, secretSalary: true, client: false } };
    expect(resolveHiddenColumns(COLUMNS, stored)).toEqual(["client", "notes"]);
  });

  it("never hides a mandatory column, whatever is stored", () => {
    const stored = { v: TABLE_PREFERENCES_VERSION, columns: { number: false } };
    expect(resolveHiddenColumns(COLUMNS, stored)).toEqual(["notes"]);
    expect(columnChoices(COLUMNS, ["number", "notes"])).toEqual({});
  });

  it("merges a new column in at its default", () => {
    const stored = { v: TABLE_PREFERENCES_VERSION, columns: { client: false } };
    const withNew: ColumnMeta[] = [
      ...COLUMNS,
      { id: "currency", label: "Currency", mandatory: false, defaultHidden: false },
      { id: "createdBy", label: "Created by", mandatory: false, defaultHidden: true },
    ];
    expect(resolveHiddenColumns(withNew, stored)).toEqual(["client", "notes", "createdBy"]);
  });

  it("stores only deviations from the defaults, so reset is the empty map", () => {
    expect(columnChoices(COLUMNS, ["notes"])).toEqual({});
    expect(columnChoices(COLUMNS, [])).toEqual({ notes: true });
    expect(columnChoices(COLUMNS, ["client", "notes"])).toEqual({ client: false });
    expect(columnChoices(COLUMNS, ["unknown"])).toEqual({ notes: true });
  });

  it("round-trips through storage holding nothing but ids, booleans, a size and the version", () => {
    const storage = memoryStorage();
    expect(writeTablePreferences(storage, KEY, { v: 1, columns: columnChoices(COLUMNS, ["client", "due", "notes"]), pageSize: 50 })).toBe(true);
    expect(JSON.parse(storage.data[KEY]!)).toEqual({ v: 1, columns: { client: false, due: false }, pageSize: 50 });
    expect(resolveHiddenColumns(COLUMNS, readTablePreferences(storage, KEY))).toEqual(["client", "due", "notes"]);
    // Another person, another workspace and another list see none of it.
    expect(readTablePreferences(storage, tablePreferenceKey({ user: "u_bob", workspace: "COMPANY:c1" }, "finance.invoices"))).toBeNull();
    expect(readTablePreferences(storage, tablePreferenceKey({ user: "u_alice", workspace: "COMPANY:c2" }, "finance.invoices"))).toBeNull();
    expect(readTablePreferences(storage, tablePreferenceKey(ALICE, "finance.payments"))).toBeNull();
  });

  it("removes the entry when a reset leaves nothing to remember", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ v: 1, columns: { client: false } }) });
    expect(writeTablePreferences(storage, KEY, { v: 1, columns: {} })).toBe(true);
    expect(storage.data).toEqual({});
  });
});

describe("page size: an explicit URL limit beats a remembered one", () => {
  const stored = { v: TABLE_PREFERENCES_VERSION, columns: {}, pageSize: 50 };

  it("uses the URL limit when there is one", () => {
    expect(effectivePageSize("25", stored, [25, 50, 100])).toEqual({ source: "url", size: null });
    expect(effectivePageSize("7", stored, [25, 50, 100])).toEqual({ source: "url", size: null });
  });

  it("uses a remembered size only when the list offers it", () => {
    expect(effectivePageSize(null, stored, [25, 50, 100])).toEqual({ source: "preference", size: 50 });
    expect(effectivePageSize("", stored, [25, 50, 100])).toEqual({ source: "preference", size: 50 });
    expect(effectivePageSize(null, stored, [25])).toEqual({ source: "default", size: null });
    expect(resolvePageSize(stored, [10, 20])).toBeNull();
    expect(effectivePageSize(null, null, [25, 50])).toEqual({ source: "default", size: null });
  });
});
