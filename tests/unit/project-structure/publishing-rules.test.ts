import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS, type PositionLevel } from "@/config/roles";
import { canMove } from "@/lib/core/state/machine";
import { STATE_MACHINES } from "@/lib/core/state/registry";
import { buildSnapshot, evaluateReadiness, hasUnpublishedChanges, isPdf, isUnitImage, publishFingerprint, unitDisplay, type LiveUnitFacts, type ReadinessInput } from "@/lib/modules/project-structure/unit-publishing.rules";
import { unitPublicationMachine } from "@/lib/modules/project-structure/unit-publication.machine";
import { addMediaSchema, publishSchema, revisionSchema, unpublishSchema, updateMediaSchema } from "@/lib/modules/project-structure/unit-publishing.schema";

/**
 * Publishing rules, without a database (E-05D §11, §13-§17, §19, §27-§30, §73).
 */

const areas = { internalArea: "92.40", grossArea: null, saleableArea: "113.00", outdoorArea: null, balconyArea: null, terraceArea: null, gardenArea: null, commonAreaAllocation: null };

function input(patch: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    unitCode: "A-901",
    unitType: { name: "Apartment", category: "RESIDENTIAL" },
    building: { name: "Block A" },
    floor: { name: "Floor 9" },
    areas,
    bedrooms: 2,
    bathrooms: 2,
    orientation: "SW",
    isActive: true,
    salesPlan: { available: true },
    primaryImage: { available: true },
    unavailableReferences: 0,
    ...patch,
  };
}

function facts(patch: Partial<LiveUnitFacts> = {}): LiveUnitFacts {
  return {
    unitCode: "A-901",
    name: "Apartment 901",
    unitType: { id: "type_apartment", name: "Apartment", category: "RESIDENTIAL" },
    building: { id: "bld_a", name: "Block A", code: "A" },
    floor: { id: "flr_9", name: "Floor 9", number: 9, levelType: "STANDARD" },
    position: "CORNER",
    orientation: "SW",
    areas,
    rooms: 3,
    bedrooms: 2,
    bathrooms: 2,
    attributes: {},
    description: null,
    salesPlan: { documentId: "doc_plan", documentVersionId: "ver_1", versionNumber: 1, fileName: "Plan.pdf" },
    primaryImage: { documentId: "doc_image", documentVersionId: "img_1", category: "COVER", caption: null },
    ...patch,
  };
}

describe("readiness (§16, §17, §45, §80)", () => {
  it("is ready when everything required is there", () => {
    const readiness = evaluateReadiness(input());
    expect(readiness).toMatchObject({ ready: true, missing: [] });
    expect(readiness.complete).toBe(readiness.required);
  });

  it("names what is missing, in order, with a hint for each", () => {
    const readiness = evaluateReadiness(input({ areas: { ...areas, saleableArea: null }, orientation: null, salesPlan: null, primaryImage: { available: false }, unavailableReferences: 2 }));
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(["Saleable area", "Orientation", "Sales Plan", "Primary image", "Attached files available"]);
    expect(readiness.items.find((item) => item.key === "salesPlan")?.hint).toBe("Upload the Sales Plan PDF.");
    expect(readiness.items.find((item) => item.key === "primaryImage")?.hint).toContain("still being checked");
    expect(readiness.items.find((item) => item.key === "references")?.hint).toContain("2 attached files");
  });

  it("does not ask a parking space for bedrooms or an orientation, and takes any of its areas", () => {
    const parking = evaluateReadiness(input({ unitType: { name: "Parking", category: "PARKING" }, bedrooms: null, bathrooms: null, orientation: null, areas: { ...areas, saleableArea: null } }));
    expect(parking.ready).toBe(true);
    expect(parking.items.map((item) => item.key)).not.toContain("bedrooms");
    const land = evaluateReadiness(input({ unitType: { name: "Land", category: "LAND" }, areas: { ...areas, saleableArea: null, grossArea: null } }));
    expect(land).toMatchObject({ ready: false, missing: ["Saleable or gross area"] });
  });

  it("counts a studio's zero bedrooms as given", () => {
    expect(evaluateReadiness(input({ bedrooms: 0 })).ready).toBe(true);
    expect(evaluateReadiness(input({ isActive: false })).missing).toEqual(["Unit is active"]);
  });
});

describe("display by kind of unit (§11)", () => {
  it("shows an apartment's rooms and orientation, a parking space's areas and position only", () => {
    expect(unitDisplay("RESIDENTIAL")).toMatchObject({ counts: ["rooms", "bedrooms", "bathrooms"], orientation: true });
    expect(unitDisplay("PARKING")).toMatchObject({ counts: [], orientation: false, position: true, areas: ["internalArea", "grossArea", "saleableArea"] });
    expect(unitDisplay("COMMERCIAL").counts).not.toContain("bedrooms");
  });
});

describe("snapshots and unpublished changes (§24, §27-§30, §73)", () => {
  it("keeps only publish-relevant data, with the exact file versions", () => {
    const snapshot = buildSnapshot(facts({ attributes: { frontage: "9.40", covered: undefined } as never }));
    expect(Object.keys(snapshot).sort()).toEqual(["areas", "attributes", "bathrooms", "bedrooms", "building", "description", "floor", "name", "orientation", "position", "primaryImage", "rooms", "salesPlan", "unitCode", "unitType"]);
    expect(snapshot.attributes).toEqual({ frontage: "9.40" });
    expect(snapshot.salesPlan?.documentVersionId).toBe("ver_1");
  });

  it("sees a changed area, code, floor, Sales Plan version or primary image — and not a renamed building", () => {
    const published = buildSnapshot(facts());
    expect(hasUnpublishedChanges(facts(), published)).toBe(false);
    expect(hasUnpublishedChanges(facts({ areas: { ...areas, saleableArea: "114.00" } }), published)).toBe(true);
    expect(hasUnpublishedChanges(facts({ unitCode: "A-902" }), published)).toBe(true);
    expect(hasUnpublishedChanges(facts({ floor: { id: "flr_10", name: "Floor 10", number: 10, levelType: "STANDARD" } }), published)).toBe(true);
    expect(hasUnpublishedChanges(facts({ salesPlan: { documentId: "doc_plan", documentVersionId: "ver_2", versionNumber: 2, fileName: "Plan.pdf" } }), published)).toBe(true);
    expect(hasUnpublishedChanges(facts({ primaryImage: null }), published)).toBe(true);
    expect(hasUnpublishedChanges(facts({ building: { id: "bld_a", name: "North Block", code: "N" } }), published)).toBe(false);
    // A never-published unit has nothing to differ from.
    expect(hasUnpublishedChanges(facts(), null)).toBe(false);
  });

  it("compares areas as numbers, so 113 and 113.00 are the same", () => {
    const published = buildSnapshot(facts({ areas: { ...areas, saleableArea: "113" } }));
    expect(publishFingerprint(published)).toBe(publishFingerprint(buildSnapshot(facts())));
  });

  it("recognises a PDF and the images a unit may show", () => {
    expect(isPdf("application/pdf", null)).toBe(true);
    expect(isPdf(null, ".PDF")).toBe(true);
    expect(isPdf("image/png", "png")).toBe(false);
    expect(["image/jpeg", "image/png", "image/webp", "image/svg+xml"].map(isUnitImage)).toEqual([true, true, true, false]);
  });
});

describe("the publication machine (§13, §14, §21-§32)", () => {
  it("is registered, and moves only the way the PRD draws it", () => {
    expect(STATE_MACHINES).toContain(unitPublicationMachine);
    expect(canMove(unitPublicationMachine, "DRAFT", "READY_FOR_PUBLISHING")).toBe(true);
    expect(canMove(unitPublicationMachine, "READY_FOR_PUBLISHING", "PUBLISHED")).toBe(true);
    expect(canMove(unitPublicationMachine, "PUBLISHED", "REVISION_REQUIRED")).toBe(true);
    expect(canMove(unitPublicationMachine, "REVISION_REQUIRED", "READY_FOR_PUBLISHING")).toBe(true);
    expect(canMove(unitPublicationMachine, "PUBLISHED", "READY_FOR_PUBLISHING")).toBe(true);
    expect(canMove(unitPublicationMachine, "PUBLISHED", "PUBLISHED")).toBe(true);
    expect(canMove(unitPublicationMachine, "PUBLISHED", "ARCHIVED")).toBe(true);
    expect(canMove(unitPublicationMachine, "ARCHIVED", "READY_FOR_PUBLISHING")).toBe(false);
    expect(canMove(unitPublicationMachine, "DRAFT", "REVISION_REQUIRED")).toBe(false);
    const byAction = Object.fromEntries(unitPublicationMachine.transitions.map((transition) => [transition.action, transition]));
    expect(byAction.request_revision.requiresReason).toBe(true);
    expect(byAction.unpublish.requiresReason).toBe(true);
    expect(byAction.publish.permission).toBe("project.unit.publish");
  });
});

describe("validation (§67, §110)", () => {
  it("requires a reason, and a version where the action changes a published unit", () => {
    expect(revisionSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(revisionSchema.parse({ reason: " Fix the plan " }).reason).toBe("Fix the plan");
    expect(unpublishSchema.safeParse({ reason: "Withdrawn" }).success).toBe(false);
    expect(publishSchema.parse({})).toEqual({});
    expect(addMediaSchema.parse({ documentId: "doc_1" })).toEqual({ documentId: "doc_1", category: "OTHER", caption: null });
    expect(updateMediaSchema.safeParse({ isPrimary: false }).success).toBe(false);
  });
});

describe("default role policy (§19, §120)", () => {
  const holders = (permission: string, position: PositionLevel = "MEMBER") => ROLE_KEYS.filter((role) => (permissionsForRole(role, position) as readonly string[]).includes(permission)).sort();

  // The CEO runs the company's units end to end (user, 2026-09-29).
  it("lets the Architect, the Project Manager, the CEO and the Owner prepare and submit units", () => {
    for (const permission of ["project.unit.documents.manage", "project.unit.media.manage", "project.unit.submit_for_publish"]) {
      expect(holders(permission), permission).toEqual(["ARCHITECT", "CEO", "OWNER", "PROJECT_MANAGER"]);
    }
  });

  it("keeps publishing, revision, unpublishing and archiving with Architecture's managers, the CEO and the Owner (E-06 §6.3)", () => {
    for (const permission of ["project.unit.publish", "project.unit.revision_request", "project.unit.unpublish", "project.unit.archive"]) {
      expect(holders(permission), permission).toEqual(["CEO", "OWNER"]);
      expect(holders(permission, "COMPANY_MANAGER"), permission).toEqual(["ARCHITECT", "CEO", "OWNER"]);
      expect(holders(permission, "GROUP_HEAD"), permission).toEqual(["ARCHITECT", "CEO", "OWNER"]);
    }
  });

  it("gives everybody who reads a unit its published history, and no publishing or structure write to Sales, Finance or the Viewer", () => {
    for (const role of ROLE_KEYS) {
      const granted = permissionsForRole(role) as readonly string[];
      expect(granted.includes("project.unit.publication_history.view"), role).toBe(granted.includes("project.structure.view"));
    }
    for (const [role, position] of [["SALES", "MEMBER"], ["SALES", "COMPANY_MANAGER"], ["FINANCE", "MEMBER"], ["VIEWER", "MEMBER"], ["ENGINEER", "MEMBER"]] as const) {
      const granted = permissionsForRole(role, position) as readonly string[];
      // Selling a unit is E-05E's, and its contract and collection E-05F's; each is tested with its own rules.
      const selling = (permission: string) => /^project\.unit\.(sales|sales_status|price|reserve|reservation|mark_sold|reopen_sale|sales_correct|sale|legal|contract|finance)\b/.test(permission);
      expect(granted.filter((permission) => permission.startsWith("project.unit.") && permission !== "project.unit.publication_history.view" && !selling(permission)), role).toEqual([]);
    }
  });
});
