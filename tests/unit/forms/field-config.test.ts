import { describe, expect, it } from "vitest";

import { submittalFields } from "@/components/engineering/record-fields";
import { decimalRule } from "@/lib/forms/decimal";
import { checkField, payloadFor, validateFieldValues, valuesFor, type FormField, type FormValues } from "@/lib/forms/field-config";

/**
 * The FormDialog kit's payload and check (AUD-09 §4, §5; FV-05, FV-10).
 * `payloadFor` used to send every hidden field as null/false; now each field
 * says what hiding it means, and the default leaves it out.
 */

const scope = (values: FormValues) => values.scope === "COMPANY";

const fields: FormField[] = [
  { name: "scope", label: "Where", type: "select", required: true, options: [{ value: "COMPANY", label: "One company" }, { value: "GROUP", label: "Group" }] },
  { name: "companyId", label: "Company", type: "select", required: true, visible: scope },
  { name: "note", label: "Note", type: "text", visible: scope, whenHidden: "clear" },
  { name: "urgent", label: "Urgent", type: "checkbox", visible: scope, whenHidden: "clear" },
  { name: "kept", label: "Kept", type: "checkbox", visible: scope },
  { name: "budget", label: "Budget", type: "text", visible: scope, whenHidden: "reject" },
  { name: "salary", label: "Salary", type: "text", restricted: true, whenHidden: "clear" },
  { name: "days", label: "Days", type: "number" },
  { name: "rate", label: "Rate", type: "number", step: "0.01" },
  { name: "price", label: "Price", type: "number", decimal: decimalRule("money", "Price") },
  { name: "reason", label: "Reason", type: "textarea", maxLength: 10 },
  { name: "startsOn", label: "Starts on", type: "date" },
  { name: "email", label: "Email", type: "email" },
];

describe("what a hidden field sends", () => {
  it("omits by default, clears only where the field says so, and never sends a restricted field", () => {
    const values = valuesFor(fields, { scope: "GROUP", companyId: "company_a", note: "x", urgent: true, kept: true, budget: "", salary: "900" });
    const payload = payloadFor(fields, values);
    expect(payload).not.toHaveProperty("companyId");
    expect(payload).not.toHaveProperty("kept");
    expect(payload).not.toHaveProperty("budget");
    expect(payload).not.toHaveProperty("salary");
    expect(payload.note).toBeNull();
    expect(payload.urgent).toBe(false);
  });

  it("sends a visible field's own value, empty as null, false as false, zero as zero", () => {
    const values = valuesFor(fields, { scope: "COMPANY", companyId: "company_a", note: "", urgent: false, kept: false, days: 0, rate: "0.50", price: "1234,50" });
    const payload = payloadFor(fields, values);
    expect(payload).toMatchObject({ scope: "COMPANY", companyId: "company_a", note: null, urgent: false, kept: false, days: 0, rate: 0.5, price: "1234.50" });
    expect(payloadFor(fields, valuesFor(fields, { scope: "COMPANY" })).days).toBeNull();
  });

  it("refuses to submit while a 'reject' field hides a value, and passes once it is empty", () => {
    const blocked = validateFieldValues(fields, valuesFor(fields, { scope: "GROUP", budget: "5000" }));
    expect(blocked.formErrors).toEqual(["Budget doesn't apply to this choice. Change the choice back and clear budget first."]);
    expect(validateFieldValues(fields, valuesFor(fields, { scope: "GROUP", budget: "" })).formErrors).toEqual([]);
  });

  it("the submittal configs clear their type-dependent fields when the type hides them (the domain's rule)", () => {
    const config = submittalFields({ contractors: [], workPackages: [], reviewers: [], members: [], suppliers: [{ id: "sup_1", label: "Supplier" }] }, "edit");
    const material = valuesFor(config, { title: "Rebar", submittalType: "METHOD_STATEMENT", manufacturer: "Acme", productName: "B500", modelNumber: "M1", supplierId: "sup_1", activity: "Pour", workArea: "L3" });
    const payload = payloadFor(config, material);
    expect(payload).toMatchObject({ manufacturer: null, productName: null, modelNumber: null, supplierId: null, activity: "Pour", workArea: "L3" });
    const hiddenPolicies = config.filter((field) => field.visible).map((field) => [field.name, field.whenHidden]);
    expect(hiddenPolicies).toEqual([
      ["manufacturer", "clear"],
      ["productName", "clear"],
      ["modelNumber", "clear"],
      ["supplierId", "clear"],
      ["activity", "clear"],
      ["workArea", "clear"],
    ]);
  });
});

describe("the client's check (FV-03, FV-04, FV-06)", () => {
  it("shows nothing for an untouched valid optional form, and names each required field", () => {
    const check = validateFieldValues(fields, valuesFor(fields, { scope: "COMPANY" }));
    expect(check.fieldErrors).toEqual({ companyId: "Choose company." });
    expect(validateFieldValues(fields, valuesFor(fields, { scope: "COMPANY", companyId: "c1" })).fieldErrors).toEqual({});
  });

  it("reads numbers by their step or rule — never NaN, never a guessed separator", () => {
    const values = valuesFor(fields, { scope: "COMPANY", companyId: "c1" });
    const days = fields.find((field) => field.name === "days")!;
    const rate = fields.find((field) => field.name === "rate")!;
    const price = fields.find((field) => field.name === "price")!;
    expect(checkField(days, "1.5", values)).toBe("Days must be a whole number, e.g. 1234.");
    expect(checkField(days, "12", values)).toBeNull();
    expect(checkField(days, "", values, true)).toBe("Days must be a number, e.g. 1234.");
    expect(checkField(rate, "0.125", values)).toMatch(/at most 2 decimal places/);
    expect(checkField(price, "1,234", values)).toMatch(/ambiguous/);
    expect(checkField(price, "-3", values)).toBe("Price cannot be negative.");
    expect(checkField(price, "1e5", values)).toMatch(/without an exponent/);
  });

  it("checks dates, emails and lengths by the server's own rules", () => {
    const values = valuesFor(fields, { scope: "COMPANY", companyId: "c1" });
    expect(checkField(fields.find((field) => field.name === "startsOn")!, "2026-02-30", values)).toMatch(/not a real date/);
    expect(checkField(fields.find((field) => field.name === "email")!, "name@", values)).toBe("Enter a valid email address.");
    expect(checkField(fields.find((field) => field.name === "reason")!, "x".repeat(11), values)).toBe("Keep this under 10 characters.");
    expect(checkField(fields.find((field) => field.name === "reason")!, "   ", values)).toBeNull();
  });
});
