import { describe, expect, it } from "vitest";

import { breadcrumbRouteMetadata } from "@/config/breadcrumb-routes";

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
