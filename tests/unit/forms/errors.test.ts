import { describe, expect, it } from "vitest";
import { z } from "zod";

import { detailsFieldErrors, errorCategory, fieldPath, firstErrors, issuesToFieldErrors, rowPathFor } from "@/lib/forms/errors";

/**
 * The error half of the contract (AUD-09 §3): stable categories, canonical
 * paths, and a row's error that stays on its row (FV-13, FV-16 groundwork).
 */

describe("categories stay distinct", () => {
  it("reads the business code first, then the API code", () => {
    expect(errorCategory("VALIDATION_ERROR")).toBe("validation");
    expect(errorCategory("VALIDATION_ERROR", "SUBMITTAL_DUE_REQUIRED")).toBe("validation");
    expect(errorCategory("CONFLICT")).toBe("conflict");
    expect(errorCategory("CONFLICT", "TASK_VERSION_CONFLICT")).toBe("conflict");
    expect(errorCategory("CONFLICT", "SUBMITTAL_STALE")).toBe("conflict");
    expect(errorCategory("CONFLICT", "UNIQUE_VIOLATION")).toBe("conflict");
    expect(errorCategory("PRECONDITION_REQUIRED", "TASK_VERSION_REQUIRED")).toBe("conflict");
    expect(errorCategory("CONFLICT", "WORKSPACE_CHANGED")).toBe("session");
    expect(errorCategory("UNAUTHENTICATED")).toBe("session");
    expect(errorCategory("FORBIDDEN")).toBe("permission");
    expect(errorCategory("NOT_FOUND")).toBe("permission");
    expect(errorCategory("MODULE_UNAVAILABLE")).toBe("permission");
    expect(errorCategory("WORKSPACE_COMPANY_REQUIRED")).toBe("permission");
    expect(errorCategory("INTERNAL_ERROR")).toBe("failure");
    expect(errorCategory("TEMPORARILY_UNAVAILABLE")).toBe("failure");
    expect(errorCategory("UNCONFIRMED")).toBe("unknown");
    expect(errorCategory("NETWORK")).toBe("unknown");
    expect(errorCategory(undefined)).toBe("unknown");
  });
});

describe("canonical paths", () => {
  it("joins every segment, row indexes included", () => {
    expect(fieldPath(["lineItems", 2, "unitPrice"])).toBe("lineItems.2.unitPrice");
    expect(fieldPath(["title"])).toBe("title");
  });

  it("maps zod issues to full paths, and a rule over the whole payload to a form error", () => {
    const schema = z
      .object({
        title: z.string().min(2, "Too short."),
        lineItems: z.array(z.object({ description: z.string().min(1, "Describe the line."), unitPrice: z.string().regex(/^\d+$/, "Digits only.") })),
      })
      .refine((value) => value.lineItems.length < 4, { message: "At most three lines." });
    const result = schema.safeParse({
      title: "x",
      lineItems: [
        { description: "a", unitPrice: "1" },
        { description: "", unitPrice: "1" },
        { description: "c", unitPrice: "1,5" },
        { description: "d", unitPrice: "4" },
      ],
    });
    expect(result.success).toBe(false);
    const mapped = issuesToFieldErrors(result.error!.issues);
    expect(mapped.fieldErrors).toEqual({
      title: ["Too short."],
      "lineItems.1.description": ["Describe the line."],
      "lineItems.2.unitPrice": ["Digits only."],
    });
    // Four lines break the rule over the whole payload too: a form-level message, no field.
    expect(mapped.formErrors).toEqual(["At most three lines."]);
    const whole = schema.safeParse({ title: "ok", lineItems: [1, 2, 3, 4].map(() => ({ description: "d", unitPrice: "1" })) });
    expect(issuesToFieldErrors(whole.error!.issues)).toEqual({ fieldErrors: {}, formErrors: ["At most three lines."] });
  });
});

describe("a row's error stays on its row", () => {
  it("maps the submitted index back through the snapshot's stable ids", () => {
    // Sent rows a, b, c; the person then removed b before the answer came.
    expect(rowPathFor("lineItems.2.unitPrice", "lineItems", ["row-a", "row-b", "row-c"])).toEqual({ rowId: "row-c", field: "unitPrice" });
    expect(rowPathFor("lineItems.5.unitPrice", "lineItems", ["row-a"])).toBeNull();
    expect(rowPathFor("title", "lineItems", ["row-a"])).toBeNull();
    expect(rowPathFor("lineItems.x.unitPrice", "lineItems", ["row-a"])).toBeNull();
  });
});

describe("field errors in a refusal's details", () => {
  it("takes message lists and a named field, and nothing else", () => {
    expect(detailsFieldErrors({ title: ["Give it a title."], code: "X" })).toEqual({ title: ["Give it a title."] });
    expect(detailsFieldErrors({ field: "dueAt", code: "SUBMITTAL_DUE_REQUIRED" }, "Give the review a due date.")).toEqual({ dueAt: ["Give the review a due date."] });
    // Lists of field names or ids are not messages.
    expect(detailsFieldErrors({ code: "SUBMITTAL_DETAILS_FROZEN", fields: ["submittalType", "manufacturer"] }, "Frozen.")).toBeUndefined();
    expect(detailsFieldErrors({ versionIds: ["v_1", "v_2"] })).toBeUndefined();
    expect(detailsFieldErrors(undefined)).toBeUndefined();
    expect(detailsFieldErrors(["a b"])).toBeUndefined();
    expect(firstErrors({ a: ["One.", "Two."], b: [] })).toEqual({ a: "One." });
  });
});
