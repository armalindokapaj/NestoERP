import { describe, expect, it } from "vitest";

import { normalizeWorkspaceSearch, workspaceRoutePolicy } from "@/config/workspace-routes";
import { moduleList } from "@/config/modules";

describe("workspace route policy registry", () => {
  it("covers every canonical module home", () => {
    for (const module of moduleList) {
      expect(workspaceRoutePolicy(module.route), module.key).toMatchObject({
        routeType: "WORKSPACE_COLLECTION",
        moduleKey: module.key,
        moduleHome: module.route,
      });
    }
  });

  it("classifies collection, record, mutation, global and platform routes", () => {
    expect(workspaceRoutePolicy("/finance/invoices")).toMatchObject({ routeType: "WORKSPACE_COLLECTION", moduleKey: "finance" });
    expect(workspaceRoutePolicy("/finance/invoices/inv-1")).toMatchObject({
      routeType: "WORKSPACE_RECORD",
      moduleKey: "finance",
      parentRoute: "/finance/invoices",
      recordValidatorKey: "INVOICE",
      recordId: "inv-1",
    });
    expect(workspaceRoutePolicy("/finance/invoices/inv-1/edit")).toMatchObject({
      routeType: "WORKSPACE_MUTATION",
      parentRoute: "/finance/invoices",
    });
    expect(workspaceRoutePolicy("/settings/profile").routeType).toBe("GLOBAL");
    expect(workspaceRoutePolicy("/admin/access").routeType).toBe("PLATFORM_ONLY");
  });

  it("does not mistake registered static module sections for record ids", () => {
    expect(workspaceRoutePolicy("/projects/milestones").routeType).toBe("WORKSPACE_COLLECTION");
    expect(workspaceRoutePolicy("/tasks/completed").routeType).toBe("WORKSPACE_COLLECTION");
  });

  it("keeps portable filters, removes workspace ids, and resets pagination", () => {
    expect(normalizeWorkspaceSearch("?status=OPEN&search=ABC&projectId=project-a&page=4&view=table"))
      .toBe("?status=OPEN&search=ABC&page=1&view=table");
  });
});
