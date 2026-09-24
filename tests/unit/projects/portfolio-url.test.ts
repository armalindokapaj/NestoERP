import { describe, expect, it } from "vitest";

import { legacyProjectsHref } from "@/app/(nesto)/projects/legacy-routes";
import { canonicalPortfolioHref, parsePortfolioQuery } from "@/lib/modules/projects/project.query";

/**
 * The Projects page's address (Projects Workspace Grid §181-§185): a search is
 * the only thing it carries, and a bookmark from before the simplification is
 * rewritten to that rather than refused.
 */
describe("the Projects page's URL", () => {
  it("reads the search and nothing that could choose a company", () => {
    expect(parsePortfolioQuery(new URLSearchParams("q=%20tirana%20&company=cmp_1&companyId=cmp_2&status=ACTIVE&sort=name-desc&view=list"))).toEqual({ q: "tirana", limit: 24 });
    // The pre-E-05A name for the search still works.
    expect(parsePortfolioQuery({ search: "lake" })).toEqual({ q: "lake", limit: 24 });
    expect(parsePortfolioQuery({ q: "   " })).toEqual({ limit: 24 });
    expect(parsePortfolioQuery({ q: "x".repeat(500) }).q).toHaveLength(200);
    expect(parsePortfolioQuery({ limit: "500", cursor: "abc" })).toEqual({ limit: 60, cursor: "abc" });
  });

  it("rewrites a URL that still carries a removed filter, sort or view, keeping the search", () => {
    expect(canonicalPortfolioHref({ q: "tirana" })).toBeNull();
    expect(canonicalPortfolioHref({})).toBeNull();
    expect(canonicalPortfolioHref({ q: "tirana", status: "ACTIVE" })).toBe("/projects?q=tirana");
    for (const key of ["status", "favorites", "company", "companyId", "role", "roleId", "type", "projectType", "location", "sort", "view"]) {
      expect(canonicalPortfolioHref({ [key]: "x" }), key).toBe("/projects");
    }
    expect(canonicalPortfolioHref(new URLSearchParams("search=Eyes of Tirana&view=list"))).toBe("/projects?q=Eyes+of+Tirana");
    // An empty value is still a stale parameter in the address bar.
    expect(canonicalPortfolioHref({ sort: "" })).toBe("/projects");
  });

  it("sends All Projects and My Projects bookmarks to the page with their search only", () => {
    expect(legacyProjectsHref({ search: "marina", status: "ACTIVE,PENDING", priority: "HIGH" })).toBe("/projects?q=marina");
    expect(legacyProjectsHref({ status: "DRAFT" })).toBe("/projects");
  });
});
