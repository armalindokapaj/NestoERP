import { describe, expect, it } from "vitest";

import type { DataScope } from "@/config/access";
import { buildClientScopeWhere, buildProjectLinkedScopeWhere, buildProjectScopeWhere, buildTaskScopeWhere, reachesWholeCompany } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * AUD-06 §3: a title never widens reach. A DEPARTMENT scope on records that
 * have no department — projects, tasks, clients, project-linked records —
 * narrows to the person's own projects, like SELF; only COMPANY, GROUP and
 * SYSTEM reach the whole company.
 */
function contextWith(scope: DataScope): UserContext {
  const access = { accessLevel: "VIEW", scope, enabled: true, permissions: [] };
  return {
    companyId: "company_x",
    membershipId: "member_x",
    userId: "user_x",
    moduleAccess: new Proxy({}, { get: (_target, key) => ({ ...access, module: key }) }),
  } as unknown as UserContext;
}

describe("DEPARTMENT scope on records without a department", () => {
  it("is not company-wide", () => {
    expect(reachesWholeCompany("DEPARTMENT")).toBe(false);
    for (const scope of ["COMPANY", "GROUP", "SYSTEM"] as const) expect(reachesWholeCompany(scope)).toBe(true);
  });

  it("narrows projects, clients and project-linked records like SELF, and tasks like PROJECT", () => {
    const department = contextWith("DEPARTMENT");
    const self = contextWith("SELF");
    expect(buildProjectScopeWhere(department)).toEqual(buildProjectScopeWhere(self));
    // Tasks read it like PROJECT: one's own, and those on one's projects — never the company's.
    expect(buildTaskScopeWhere(department)).toEqual(buildTaskScopeWhere(contextWith("PROJECT")));
    expect(buildTaskScopeWhere(department)).not.toEqual(buildTaskScopeWhere(contextWith("COMPANY")));
    expect(buildClientScopeWhere(department)).toEqual(buildClientScopeWhere(self));
    expect(buildProjectLinkedScopeWhere(department, "finance")).toEqual(buildProjectLinkedScopeWhere(self, "finance"));
    // And differs from the whole company.
    expect(buildProjectScopeWhere(department)).not.toEqual(buildProjectScopeWhere(contextWith("COMPANY")));
  });
});
