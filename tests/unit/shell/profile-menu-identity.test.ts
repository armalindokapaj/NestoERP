import { describe, expect, it } from "vitest";

import { roleAndCompany } from "@/lib/utils/format";

/** The account menu's second line (Profile Menu PRD §4, §82-§85, §108, §109). */
describe("roleAndCompany", () => {
  it("joins role and company with a middle dot", () => {
    expect(roleAndCompany("Legal", "ARLIS - NDERTIM")).toBe("Legal · ARLIS - NDERTIM");
  });

  it("names the group in the Group workspace", () => {
    expect(roleAndCompany("Legal", "ARMAAR GROUP")).toBe("Legal · ARMAAR GROUP");
  });

  it("shows the company alone when there is no role, with no dangling dot", () => {
    expect(roleAndCompany(null, "ARLIS - NDERTIM")).toBe("ARLIS - NDERTIM");
    expect(roleAndCompany("  ", "ARLIS - NDERTIM")).toBe("ARLIS - NDERTIM");
  });

  it("shows the role alone when there is no company", () => {
    expect(roleAndCompany("Legal", undefined)).toBe("Legal");
    expect(roleAndCompany("Legal", "")).toBe("Legal");
  });

  it("is empty when there is neither, so the line is left out", () => {
    expect(roleAndCompany(null, null)).toBe("");
  });

  it("keeps the configured capitalization", () => {
    expect(roleAndCompany("Head of Group Finance", "IDEAL Construction")).toBe("Head of Group Finance · IDEAL Construction");
  });
});
