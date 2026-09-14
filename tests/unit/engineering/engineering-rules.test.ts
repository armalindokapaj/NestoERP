import { describe, expect, it } from "vitest";

import { FILTER_CATEGORIES } from "@/components/calendar/calendar-model";
import { isMutatingPermission, moduleForPermission, type Permission } from "@/config/permissions";
import { accessibleModules, permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";
import { deriveComplianceStatus } from "@/lib/modules/contractors/contractor.compliance";
import { normalizeContractorName } from "@/lib/modules/contractors/contractor.names";
import { createComplianceSchema, createWorkPackageSchema, updateAssignmentSchema } from "@/lib/modules/contractors/contractor.schema";
import { createRevisionSchema, reviewDecisionSchema, updateRfiSchema, updateSubmittalSchema } from "@/lib/modules/engineering/engineering.schema";
import { APPROVING_DECISIONS, DRAWING_TYPES, LINKABLE_TYPES } from "@/lib/modules/engineering/engineering.types";

/**
 * Contractor and engineering rules that need no database (PRD #46 §16, §48,
 * §69-§74, §175-§193, §252): names, derived compliance, validation that never
 * carries a status, and the role defaults the PRD describes.
 */

const has = (role: (typeof ROLE_KEYS)[number], permission: Permission) => permissionsForRole(role).includes(permission);

describe("contractor names (§16)", () => {
  it("treats punctuation, case, accents and legal suffixes as the same name", () => {
    expect(normalizeContractorName("ABC Construction Sh.p.k.")).toBe("abc construction");
    expect(normalizeContractorName("abc  construction")).toBe("abc construction");
    expect(normalizeContractorName("Brightline Façades Ltd")).toBe("brightline facades");
    expect(normalizeContractorName("Ltd")).toBe("ltd");
  });
});

describe("compliance status (§43, §48)", () => {
  const today = "2026-09-14";
  it("follows the expiry date and the reminder window, and leaves decided statuses alone", () => {
    expect(deriveComplianceStatus({ status: "VALID", expiresAt: null }, today, 30)).toBe("VALID");
    expect(deriveComplianceStatus({ status: "VALID", expiresAt: "2026-09-13" }, today, 30)).toBe("EXPIRED");
    expect(deriveComplianceStatus({ status: "VALID", expiresAt: "2026-09-14" }, today, 30)).toBe("EXPIRING");
    expect(deriveComplianceStatus({ status: "VALID", expiresAt: "2026-10-14" }, today, 30)).toBe("EXPIRING");
    expect(deriveComplianceStatus({ status: "VALID", expiresAt: "2026-10-15" }, today, 30)).toBe("VALID");
    expect(deriveComplianceStatus({ status: "MISSING", expiresAt: "2020-01-01" }, today, 30)).toBe("MISSING");
    expect(deriveComplianceStatus({ status: "WAIVED", expiresAt: "2020-01-01" }, today, 30)).toBe("WAIVED");
  });

  it("accepts only VALID or MISSING from a person; the rest are derived", () => {
    expect(() => createComplianceSchema.parse({ type: "INSURANCE", title: "Policy", status: "EXPIRED" })).toThrow();
    expect(() => createComplianceSchema.parse({ type: "INSURANCE", title: "Policy", issuedAt: "2026-09-10", expiresAt: "2026-09-01" })).toThrow();
  });
});

describe("validation never carries a state change (§252)", () => {
  it("has no status on RFI, submittal or revision updates", () => {
    expect(Object.keys(updateRfiSchema.shape)).not.toContain("status");
    expect(Object.keys(updateSubmittalSchema.shape)).not.toContain("status");
    expect(Object.keys(createRevisionSchema.shape)).not.toContain("status");
  });

  it("keeps termination and completion out of plain edits", () => {
    expect(() => updateAssignmentSchema.parse({ status: "TERMINATED", expectedVersion: 1 })).toThrow();
    expect(() => createWorkPackageSchema.parse({ name: "Frame", status: "COMPLETED" })).toThrow();
    expect(() => createWorkPackageSchema.parse({ name: "Frame", plannedStartDate: "2026-10-01", plannedFinishDate: "2026-09-01" })).toThrow();
  });

  it("asks the reviewer to say why, short of a clean approval, and takes the company's own revision codes (§72, §73)", () => {
    expect(reviewDecisionSchema.parse({ decision: "APPROVED" }).comment).toBeNull();
    for (const decision of ["APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED"]) expect(() => reviewDecisionSchema.parse({ decision })).toThrow();
    for (const revisionCode of ["A", "01", "P01", "C01", "B.1"]) expect(createRevisionSchema.parse({ revisionCode, documentId: "doc_1" }).revisionCode).toBe(revisionCode);
    for (const revisionCode of ["", "Rev A!", "A B"]) expect(() => createRevisionSchema.parse({ revisionCode, documentId: "doc_1" })).toThrow();
    expect(APPROVING_DECISIONS).toEqual(["APPROVED", "APPROVED_WITH_COMMENTS"]);
  });
});

describe("registers and links (§76, §133-§155, §200)", () => {
  it("puts drawings and shop drawings in the drawing register, engineering dates on the calendar, and links only to other modules' records", () => {
    expect(DRAWING_TYPES).toEqual(["DRAWING", "SHOP_DRAWING"]);
    expect(FILTER_CATEGORIES).toContain("ENGINEERING");
    expect(LINKABLE_TYPES).toEqual(expect.arrayContaining(["task", "meeting", "daily_log", "non_conformance_report", "work_permit", "purchase_order", "obligation"]));
    expect(LINKABLE_TYPES).not.toContain("contract");
  });
});

describe("permissions and role defaults (§175-§193)", () => {
  it("maps every family to its module and treats open, respond and waive as writes", () => {
    expect(moduleForPermission("contractor_compliance.waive")).toBe("contractors");
    expect(moduleForPermission("work_package.complete")).toBe("contractors");
    expect(moduleForPermission("rfi.respond")).toBe("engineering");
    expect(moduleForPermission("transmittal.issue")).toBe("engineering");
    for (const permission of ["rfi.open", "rfi.respond", "contractor_compliance.waive", "transmittal.issue", "rfi.void"] as const) expect(isMutatingPermission(permission), permission).toBe(true);
  });

  it("gives each role the authority the PRD describes, and no more", () => {
    expect(has("OWNER", "contractor.archive") && has("OWNER", "engineering.settings.manage")).toBe(true);
    expect(accessibleModules("ADMIN")).not.toContain("engineering");
    expect(has("ADMIN", "contractor.view") && !has("ADMIN", "contractor.create")).toBe(true);
    expect(accessibleModules("COMPANY_IT")).not.toContain("contractors");
    expect(accessibleModules("HR")).not.toContain("contractors");
    expect(has("CEO", "rfi.view") && !has("CEO", "rfi.create")).toBe(true);
    expect(has("PROJECT_MANAGER", "project_contractor.manage") && has("PROJECT_MANAGER", "rfi.void") && has("PROJECT_MANAGER", "submittal.approve")).toBe(true);
    expect(has("PROJECT_MANAGER", "engineering.settings.manage")).toBe(false);
    expect(has("ARCHITECT", "engineering_document.approve") && has("ARCHITECT", "rfi.respond")).toBe(true);
    expect(has("ENGINEER", "rfi.create") && has("ENGINEER", "submittal.review")).toBe(true);
    expect(has("ENGINEER", "contractor.create")).toBe(false);
    expect(has("FINANCE", "contractor.view")).toBe(true);
    expect(accessibleModules("FINANCE")).not.toContain("engineering");
    expect(has("LEGAL", "contractor_compliance.waive") && !has("LEGAL", "contractor.archive")).toBe(true);
    expect(accessibleModules("SALES")).not.toContain("contractors");
    expect(accessibleModules("SALES")).not.toContain("engineering");
    expect(has("PROCUREMENT", "submittal.view") && !has("PROCUREMENT", "submittal.review")).toBe(true);
    expect(has("INVENTORY", "submittal.view")).toBe(true);
    expect(has("QAQC", "submittal.approve") && has("QAQC", "engineering_document.review") && !has("QAQC", "rfi.close")).toBe(true);
    expect(has("HSE", "submittal.review") && !has("HSE", "engineering_document.review")).toBe(true);
  });

  it("leaves the Viewer read-only in both modules (§193)", () => {
    const viewer = permissionsForRole("VIEWER").filter((permission) => ["contractors", "engineering"].includes(moduleForPermission(permission) ?? ""));
    expect(viewer).toEqual(expect.arrayContaining(["contractor.view", "rfi.view", "submittal.view"]));
    expect(viewer.filter((permission) => isMutatingPermission(permission))).toEqual([]);
  });
});
