import { describe, expect, it } from "vitest";

import type { Permission } from "@/config/permissions";
import { roleModuleAccess } from "@/config/role-defaults";
import type { UserContext } from "@/lib/context/types";
import { mayManageUnitDocument } from "@/lib/modules/project-structure/unit-documents.rules";

/**
 * Sales units (/sales/units, 2026-11-12): whoever sells a unit files the
 * buyer's signed contract on it — and nothing else of the architect's — and
 * keeps the buyer's payment schedule. Recording a payment stays Finance's.
 */
const holding = (...permissions: Permission[]) => ({ permissions }) as unknown as UserContext;
const held = (role: keyof typeof roleModuleAccess) => new Set<string>(Object.values(roleModuleAccess[role]).flatMap((access) => access.permissions));

describe("who files a unit's documents, by category", () => {
  it("lets the seller file the buyer's contract and nothing else", () => {
    const seller = holding("project.unit.sale_contract.manage");
    expect(mayManageUnitDocument(seller, "CONTRACT")).toBe(true);
    for (const category of ["SALES_PLAN", "TECHNICAL_DRAWING", "SPECIFICATION", "FINANCE", "LEGAL", "OTHER"] as const) {
      expect(mayManageUnitDocument(seller, category), category).toBe(false);
    }
  });

  it("lets whoever keeps the unit's documents file every category", () => {
    const architect = holding("project.unit.documents.manage");
    for (const category of ["CONTRACT", "SALES_PLAN", "TECHNICAL_DRAWING", "OTHER"] as const) expect(mayManageUnitDocument(architect, category), category).toBe(true);
  });

  it("lets nobody else file anything", () => {
    expect(mayManageUnitDocument(holding("project.unit.sales.view", "project.unit.mark_sold"), "CONTRACT")).toBe(false);
  });
});

describe("the Sales role on a unit", () => {
  const sales = held("SALES");

  it("files the buyer's contract and keeps the payment schedule", () => {
    expect(sales.has("project.unit.sale_contract.manage")).toBe(true);
    expect(sales.has("project.unit.finance.manage_schedule")).toBe(true);
  });

  it("changes none of the architect's part, and records no payment", () => {
    for (const permission of ["project.unit.update", "project.unit.documents.manage", "project.unit.media.manage", "project.unit.finance.record_payment"]) {
      expect(sales.has(permission), permission).toBe(false);
    }
  });

  it("is joined by the Owner and the CEO on the contract", () => {
    expect(held("OWNER").has("project.unit.sale_contract.manage")).toBe(true);
    expect(held("CEO").has("project.unit.sale_contract.manage")).toBe(true);
  });
});
