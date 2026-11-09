import { describe, expect, it } from "vitest";

import { breadcrumbRouteMetadata, fallbackParent, workspaceCrumbs } from "@/config/breadcrumb-routes";

describe("breadcrumb route metadata", () => {
  it("derives module and collection labels from the canonical module registry", () => {
    expect(breadcrumbRouteMetadata("/finance/invoices/invoice-1")).toMatchObject({
      moduleKey: "finance",
      moduleLabel: "Finance",
      moduleHref: "/finance",
      collectionLabel: "Invoices",
      collectionHref: "/finance/invoices",
    });
  });

  it("normalizes query strings and trailing slashes", () => {
    expect(breadcrumbRouteMetadata("/projects/archived/?page=2")).toMatchObject({
      moduleKey: "projects",
      moduleHref: "/projects",
      collectionHref: "/projects/archived",
    });
  });

  it("does not invent hierarchy for routes outside tenant modules", () => {
    expect(breadcrumbRouteMetadata("/admin/companies")).toBeNull();
    expect(breadcrumbRouteMetadata("/sign-in")).toBeNull();
  });
});

describe("workspace crumbs", () => {
  const company = { scopeType: "COMPANY" as const, groupName: "ARVELA Group", companyName: "EOT Construction", standalone: false };

  it("names neither group nor company in a tenant of one company", () => {
    expect(workspaceCrumbs({ ...company, groupName: "EL&EL Construction", companyName: "EL&EL Construction", standalone: true, canEnterGroup: null })).toEqual({ group: false, company: false });
    expect(workspaceCrumbs({ ...company, standalone: true, canEnterGroup: true })).toEqual({ group: false, company: false });
  });

  it("names the group alone in the Group view", () => {
    expect(workspaceCrumbs({ ...company, scopeType: "GROUP", companyName: null, canEnterGroup: true })).toEqual({ group: true, company: false });
  });

  it("in a company of a larger group, names the group only while it is a way in", () => {
    expect(workspaceCrumbs({ ...company, canEnterGroup: true })).toEqual({ group: true, company: true });
    expect(workspaceCrumbs({ ...company, canEnterGroup: false })).toEqual({ group: false, company: true });
    expect(workspaceCrumbs({ ...company, canEnterGroup: null })).toEqual({ group: false, company: true });
  });

  it("never names a group that bears the company's own name", () => {
    expect(workspaceCrumbs({ ...company, groupName: "EOT Construction", canEnterGroup: true })).toEqual({ group: false, company: true });
  });
});

describe("fallback parent", () => {
  const trail = [
    { label: "EL&EL Construction", href: "/dashboard" },
    { label: "Projects", href: "/projects" },
    { label: "Tailor of Tirana" },
  ];

  it("is the nearest parent that is a link", () => {
    expect(fallbackParent(trail, "/projects/p1")?.label).toBe("Projects");
  });

  it("is never the page already open", () => {
    expect(fallbackParent([{ label: "EL&EL Construction", href: "/dashboard" }, { label: "Dashboard", href: "/dashboard" }], "/dashboard/")).toBeNull();
    expect(fallbackParent([trail[0], { label: "Projects" }], "/projects")?.label).toBe("EL&EL Construction");
  });
});
