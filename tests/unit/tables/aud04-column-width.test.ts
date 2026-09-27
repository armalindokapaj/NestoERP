import { describe, expect, it } from "vitest";

import type { ColumnMeta } from "@/lib/tables/columns";
import { TABLE_PREFERENCES_VERSION, resolveHiddenColumns, type StoredTablePreferences } from "@/lib/tables/preferences";
import { sortChoices } from "@/lib/tables/sort";
import {
  columnStatesAt,
  effectiveHideBelow,
  hiddenByWidth,
  hiddenColumnsAt,
  isFigureColumn,
  shownOverWidth,
  withColumnChoiceAt,
} from "@/lib/tables/visibility";

/**
 * AUD-04 §5, MW-05: which columns a table shows at the width it is drawn at,
 * and how the Columns control recovers a column its breakpoint hides on a
 * tablet. Expected sets are written out by hand from the fixture.
 */

const COLUMNS: ColumnMeta[] = [
  { id: "number", label: "Invoice", mandatory: true, defaultHidden: false },
  { id: "project", label: "Project", mandatory: false, defaultHidden: false, hideBelow: "xl" },
  { id: "due", label: "Due", mandatory: false, defaultHidden: false, valueType: "date", hideBelow: "lg" },
  { id: "status", label: "Status", mandatory: false, defaultHidden: false, valueType: "status" },
  { id: "notes", label: "Notes", mandatory: false, defaultHidden: true, hideBelow: "lg" },
];

const stored = (columns: Record<string, boolean>): StoredTablePreferences => ({ v: TABLE_PREFERENCES_VERSION, columns });

describe("figure columns never hide by width", () => {
  it("money and number columns, and right-aligned columns without a value type, are figures", () => {
    expect(isFigureColumn({ valueType: "money" })).toBe(true);
    expect(isFigureColumn({ valueType: "number", align: "right" })).toBe(true);
    expect(isFigureColumn({ align: "right" })).toBe(true);
    expect(isFigureColumn({ valueType: "date", align: "right" })).toBe(false);
    expect(isFigureColumn({ valueType: "status" })).toBe(false);
    expect(isFigureColumn({})).toBe(false);
  });

  it("drops hideBelow from a figure column and keeps it elsewhere", () => {
    expect(effectiveHideBelow({ valueType: "money", hideBelow: "lg" })).toBeUndefined();
    expect(effectiveHideBelow({ align: "right", hideBelow: "md" })).toBeUndefined();
    expect(effectiveHideBelow({ valueType: "date", hideBelow: "lg" })).toBe("lg");
    expect(effectiveHideBelow({})).toBeUndefined();
  });
});

describe("width-hidden columns", () => {
  it("hide only between md and their breakpoint; phones (cards) and unknown width never count", () => {
    const due = { hideBelow: "lg" as const };
    const project = { hideBelow: "xl" as const };
    expect(hiddenByWidth(due, undefined)).toBe(false);
    expect(hiddenByWidth(due, 390)).toBe(false);
    expect(hiddenByWidth(due, 768)).toBe(true);
    expect(hiddenByWidth(due, 820)).toBe(true);
    expect(hiddenByWidth(due, 1024)).toBe(false);
    expect(hiddenByWidth(project, 1024)).toBe(true);
    expect(hiddenByWidth(project, 1199)).toBe(true);
    // xl is the design system's 1200px (styles/globals.css), not Tailwind's 1280.
    expect(hiddenByWidth(project, 1200)).toBe(false);
    expect(hiddenByWidth({}, 768)).toBe(false);
  });

  it("states: mandatory, choice, default and width, at tablet and desktop", () => {
    expect(columnStatesAt(COLUMNS, null, 768)).toEqual([
      { id: "number", visible: true, reason: "mandatory" },
      { id: "project", visible: false, reason: "width" },
      { id: "due", visible: false, reason: "width" },
      { id: "status", visible: true, reason: "default" },
      { id: "notes", visible: false, reason: "default" },
    ]);
    expect(hiddenColumnsAt(COLUMNS, null, 1024)).toEqual(["project", "notes"]);
    expect(hiddenColumnsAt(COLUMNS, null, 1440)).toEqual(["notes"]);
    // Before hydration the control agrees with the server render: no width.
    expect(hiddenColumnsAt(COLUMNS, null, undefined)).toEqual(resolveHiddenColumns(COLUMNS, null));
    // Phone: cards carry every line, so only real choices hide.
    expect(hiddenColumnsAt(COLUMNS, null, 360)).toEqual(["notes"]);
  });

  it("a stored choice beats the breakpoint either way", () => {
    const prefs = stored({ due: true, project: false });
    expect(hiddenColumnsAt(COLUMNS, prefs, 768)).toEqual(["project", "notes"]);
    expect(hiddenColumnsAt(COLUMNS, prefs, 1440)).toEqual(["project", "notes"]);
    expect(shownOverWidth(COLUMNS, prefs)).toEqual(["due"]);
    // A shown default-hidden column with a breakpoint shows at every width too.
    expect(shownOverWidth(COLUMNS, stored({ notes: true }))).toEqual(["notes"]);
    // The CSS the table draws with keeps AUD-08's meaning: only real hides.
    expect(resolveHiddenColumns(COLUMNS, prefs)).toEqual(["project", "notes"]);
  });
});

describe("the Columns control at a width", () => {
  it("showing a width-hidden column on a tablet stores a choice that overrides the breakpoint", () => {
    const choices = withColumnChoiceAt(COLUMNS, null, "due", true, 768);
    expect(choices).toEqual({ due: true });
    expect(hiddenColumnsAt(COLUMNS, stored(choices), 768)).toEqual(["project", "notes"]);
    expect(shownOverWidth(COLUMNS, stored(choices))).toEqual(["due"]);
  });

  it("a choice equal to what the width shows anyway is not stored", () => {
    expect(withColumnChoiceAt(COLUMNS, stored({ due: true }), "due", false, 768)).toEqual({});
    expect(withColumnChoiceAt(COLUMNS, null, "due", false, 820)).toEqual({});
    expect(withColumnChoiceAt(COLUMNS, null, "due", true, 1440)).toEqual({});
  });

  it("hiding at desktop is stored as before AUD-04 (DT-08)", () => {
    expect(withColumnChoiceAt(COLUMNS, null, "status", false, 1440)).toEqual({ status: false });
    expect(withColumnChoiceAt(COLUMNS, null, "status", false, undefined)).toEqual({ status: false });
    expect(withColumnChoiceAt(COLUMNS, null, "notes", true, 1440)).toEqual({ notes: true });
  });

  it("keeps other choices, drops unknown and mandatory ids, and never stores a mandatory column", () => {
    const prefs = stored({ project: false, gone: false, number: false });
    expect(withColumnChoiceAt(COLUMNS, prefs, "due", true, 768)).toEqual({ project: false, due: true });
    expect(withColumnChoiceAt(COLUMNS, prefs, "number", false, 768)).toEqual({ project: false });
  });
});

describe("the phone Sort control's options (MW-06)", () => {
  const columns = [
    { label: "Invoice", sortKey: "number" },
    { label: "Project" },
    { label: "Due", sortKey: "due", valueType: "date" as const },
    { label: "Total", sortKey: "amount", valueType: "money" as const },
    { label: "Updated", sortKey: "recent" },
  ];

  it("offers only allowlisted orders, in column order, naming column and direction", () => {
    expect(sortChoices(columns, ["due-asc", "due-desc", "amount-desc", "number-asc", "recent"])).toEqual([
      { value: "number-asc", label: "Invoice: A–Z" },
      { value: "due-asc", label: "Due: earliest first" },
      { value: "due-desc", label: "Due: latest first" },
      { value: "amount-desc", label: "Total: highest first" },
      { value: "recent", label: "Updated" },
    ]);
  });

  it("without an allowlist both directions of each stem are assumed", () => {
    expect(sortChoices([{ label: "Name", sortKey: "name" }])).toEqual([
      { value: "name-asc", label: "Name: A–Z" },
      { value: "name-desc", label: "Name: Z–A" },
    ]);
  });

  it("nothing sortable, nothing offered", () => {
    expect(sortChoices([{ label: "Name" }], ["name-asc"])).toEqual([]);
  });
});
