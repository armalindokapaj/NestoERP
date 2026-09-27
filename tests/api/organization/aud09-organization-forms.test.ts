import { describe, expect, it } from "vitest";

import { grantAccessSchema } from "@/lib/modules/organization/access-grant.service";

/**
 * AUD-09 (Forms & Validation) for the access-grant dialog (FV-04, FV-10). Its
 * company field is shown for a company grant only and omitted otherwise; the
 * server holds the same rule, forged requests included: a company grant must
 * name its company, and a group grant naming one is refused, not ignored.
 */
const base = { userId: "user_x", moduleKey: "finance", accessLevel: "VIEW", reason: "Covering month-end close" };

describe("access grant scope (FV-10: reject incompatible state)", () => {
  it("refuses a group grant that carries a company, on the company field", () => {
    const parsed = grantAccessSchema.safeParse({ ...base, scope: "GROUP", scopeCompanyId: "company_demo_a" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([["scopeCompanyId"]]);
  });

  it("refuses a company grant without its company", () => {
    const parsed = grantAccessSchema.safeParse({ ...base, scope: "COMPANY" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["scopeCompanyId"]);
  });

  it("positive controls: the dialog's two shapes parse", () => {
    expect(grantAccessSchema.safeParse({ ...base, scope: "GROUP" }).success).toBe(true);
    expect(grantAccessSchema.safeParse({ ...base, scope: "COMPANY", scopeCompanyId: "company_demo_a" }).success).toBe(true);
  });
});
