import { describe, expect, it } from "vitest";

import { decimalRule } from "@/lib/forms/decimal";
import { normalizeFormData, normalizePayload, PRESENT_FIELD, type FieldSpecs } from "@/lib/forms/normalize";
import { patchBoolean, patchEnum, patchId, patchText } from "@/lib/modules/shared/fields";

/**
 * FV-05: omitted, empty, explicit clear, zero and false are five different
 * things (AUD-09 §4), and the browser's FormData and a JSON body are read by
 * the same rule. Expectations are written out by hand for each case.
 */

const specs: FieldSpecs = {
  title: { kind: "text", label: "Title", required: true, max: 20 },
  description: { kind: "text", label: "Description", max: 50 },
  status: { kind: "enum", label: "Status", values: ["TODO", "DONE"], createDefault: "TODO" },
  priority: { kind: "enum", label: "Priority", values: ["LOW", "HIGH"], createDefault: "LOW" },
  billable: { kind: "boolean", label: "Billable", createDefault: false },
  amount: { kind: "decimal", label: "Amount", rule: decimalRule("money", "Amount") },
  dueDate: { kind: "date", label: "Due date" },
  projectId: { kind: "id", label: "Project" },
  tagIds: { kind: "list", label: "Tags" },
  companyId: { kind: "id", serverOwned: true },
  totalAmount: { kind: "decimal", rule: decimalRule("money", "Total"), serverOwned: true },
};

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("an update never erases what it did not mention", () => {
  it("omits absent keys: no create default, no null", () => {
    const result = normalizeFormData(form([["title", "Pour slab"]]), specs, { mode: "update" });
    expect(result).toEqual({
      ok: true,
      data: { title: "Pour slab" },
      omitted: ["description", "status", "priority", "billable", "amount", "dueDate", "projectId", "tagIds"],
      ignored: [],
    });
  });

  it("reads an empty control as the person clearing it: null, never zero or a default", () => {
    const result = normalizeFormData(form([["description", ""], ["amount", "  "], ["dueDate", ""], ["projectId", ""], ["status", ""]]), specs, { mode: "update" });
    expect(result).toMatchObject({ ok: true, data: { description: null, amount: null, dueDate: null, projectId: null, status: null } });
  });

  it("keeps zero as zero and a set value as its canonical form", () => {
    const result = normalizeFormData(form([["amount", "0"], ["dueDate", "2026-09-27"], ["description", "  Level 3  "], ["projectId", "proj_1"]]), specs, { mode: "update" });
    expect(result).toMatchObject({ ok: true, data: { amount: "0", dueDate: "2026-09-27", description: "Level 3", projectId: "proj_1" } });
  });

  it("an unchecked box is false only where the form said the box was there", () => {
    expect(normalizeFormData(form([]), specs, { mode: "update" })).toMatchObject({ ok: true, omitted: expect.arrayContaining(["billable"]) });
    const rendered = normalizeFormData(form([[PRESENT_FIELD, "billable"]]), specs, { mode: "update" });
    expect(rendered).toMatchObject({ ok: true, data: { billable: false } });
    expect(normalizeFormData(form([["billable", "on"]]), specs, { mode: "update" })).toMatchObject({ ok: true, data: { billable: true } });
  });

  it("an emptied multi-select is [] only where the form said it was there", () => {
    expect(normalizeFormData(form([[PRESENT_FIELD, "tagIds,billable"]]), specs, { mode: "update" })).toMatchObject({ ok: true, data: { tagIds: [], billable: false } });
    expect(normalizeFormData(form([["tagIds", "a"], ["tagIds", "b"], ["tagIds", "a"]]), specs, { mode: "update" })).toMatchObject({ ok: true, data: { tagIds: ["a", "b"] } });
  });
});

describe("a create applies its defaults only to what is absent", () => {
  it("defaults omitted keys, but not an explicit empty choice", () => {
    const result = normalizeFormData(form([["title", "Pour slab"], ["priority", ""]]), specs, { mode: "create" });
    expect(result).toMatchObject({ ok: true, data: { title: "Pour slab", status: "TODO", billable: false, priority: null } });
  });

  it("requires a required field on create, and not on update when untouched", () => {
    expect(normalizeFormData(form([]), specs, { mode: "create" })).toEqual({ ok: false, fieldErrors: { title: ["Enter title."] }, ignored: [] });
    expect(normalizeFormData(form([]), specs, { mode: "update" }).ok).toBe(true);
  });

  it("refuses whitespace-only for required text, on either mode", () => {
    expect(normalizeFormData(form([["title", "   "]]), specs, { mode: "update" })).toMatchObject({ ok: false, fieldErrors: { title: ["Enter title."] } });
  });
});

describe("bad values are refused under the field's own key", () => {
  it("reports each field's own message", () => {
    const result = normalizeFormData(
      form([["title", "x".repeat(21)], ["amount", "1,234"], ["dueDate", "2026-02-30"], ["status", "ARCHIVED"], ["projectId", "a b"], ["billable", "maybe"]]),
      specs,
      { mode: "update" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["amount", "billable", "dueDate", "projectId", "status", "title"]);
    expect(result.fieldErrors.title).toEqual(["Title must be 20 characters or fewer."]);
    expect(result.fieldErrors.amount[0]).toContain("ambiguous");
    expect(result.fieldErrors.dueDate[0]).toContain("not a real date");
    expect(result.fieldErrors.status).toEqual(["Choose a valid status."]);
    expect(result.fieldErrors.projectId).toEqual(["Unknown record."]);
  });
});

describe("server-owned and unknown keys never reach the write", () => {
  it("ignores them by default and names them", () => {
    const result = normalizeFormData(form([["title", "A title"], ["companyId", "company_other"], ["totalAmount", "0.01"], ["createdByMemberId", "m_1"]]), specs, { mode: "update" });
    expect(result).toMatchObject({ ok: true, data: { title: "A title" } });
    if (!result.ok) return;
    expect(result.data).not.toHaveProperty("companyId");
    expect(result.data).not.toHaveProperty("totalAmount");
    expect(result.data).not.toHaveProperty("createdByMemberId");
    expect(result.ignored.sort()).toEqual(["companyId", "createdByMemberId", "totalAmount"]);
  });

  it("refuses them where the endpoint's contract says so", () => {
    const result = normalizePayload({ title: "A title", companyId: "company_other" }, specs, { mode: "update", unknownKeys: "reject" });
    expect(result).toEqual({ ok: false, fieldErrors: { companyId: ["This field can't be set here."] }, ignored: ["companyId"] });
  });
});

describe("a JSON body follows the same rules as FormData", () => {
  it("missing or undefined is omitted; null or empty is a clear; values are read by kind", () => {
    const result = normalizePayload({ title: "A title", description: null, amount: "", dueDate: undefined, billable: false, tagIds: ["t1"], projectId: null }, specs, { mode: "update" });
    expect(result).toEqual({
      ok: true,
      data: { title: "A title", description: null, amount: null, billable: false, tagIds: ["t1"], projectId: null },
      omitted: ["status", "priority", "dueDate"],
      ignored: [],
    });
  });

  it("reads a JSON number through the decimal rule — NaN, Infinity and exponents refused", () => {
    expect(normalizePayload({ amount: 12.5 }, specs, { mode: "update" })).toMatchObject({ ok: true, data: { amount: "12.5" } });
    expect(normalizePayload({ amount: 0 }, specs, { mode: "update" })).toMatchObject({ ok: true, data: { amount: "0" } });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1e21, 1e-7]) {
      expect(normalizePayload({ amount: bad }, specs, { mode: "update" }).ok, String(bad)).toBe(false);
    }
  });

  it("refuses null for a boolean rather than reading it as false", () => {
    expect(normalizePayload({ billable: null }, specs, { mode: "update" })).toMatchObject({ ok: false, fieldErrors: { billable: ["Billable must be yes or no."] } });
    expect(normalizePayload({ title: ["a"] }, specs, { mode: "update" })).toMatchObject({ ok: false, fieldErrors: { title: ["Title is not valid."] } });
  });
});

describe("the shared patch schema fields agree with the normaliser", () => {
  it("absent → undefined, empty or null → null, value → value", () => {
    const text = patchText(10);
    expect(text.parse(undefined)).toBeUndefined();
    expect(text.parse("")).toBeNull();
    expect(text.parse("   ")).toBeNull();
    expect(text.parse(null)).toBeNull();
    expect(text.parse(" a ")).toBe("a");
    expect(text.safeParse("x".repeat(11)).success).toBe(false);
    expect(patchId.parse(undefined)).toBeUndefined();
    expect(patchId.parse("")).toBeNull();
    const status = patchEnum(["TODO", "DONE"] as const);
    expect(status.parse(undefined)).toBeUndefined();
    expect(status.parse("")).toBeNull();
    expect(status.parse("DONE")).toBe("DONE");
    expect(status.safeParse("ARCHIVED").success).toBe(false);
    expect(patchBoolean.parse(undefined)).toBeUndefined();
    expect(patchBoolean.parse(false)).toBe(false);
    expect(patchBoolean.parse("false")).toBe(false);
    expect(patchBoolean.parse("on")).toBe(true);
  });
});
