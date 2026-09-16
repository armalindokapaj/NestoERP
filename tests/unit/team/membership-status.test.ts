import { describe, expect, it } from "vitest";

import {
  canTransitionDepartmentStatus,
  canTransitionMembershipStatus,
  isCompanyAccessAllowed,
  isDepartmentArchived,
  membershipStatusLabels,
} from "@/lib/modules/team/membership.status";

/** Membership and department lifecycle rules (PRD #14 §109, §110, §128). */
describe("membership transitions (PRD #14 §109)", () => {
  it("never activates an invitation by administration — only acceptance does (PRD #47 §58)", () => {
    expect(canTransitionMembershipStatus("INVITED", "ACTIVE")).toBe(false);
    expect(canTransitionMembershipStatus("INVITED", "INACTIVE")).toBe(true);
  });

  it("never pushes an active member back into INVITED", () => {
    // An invitation is how somebody arrives, not a state they can be returned
    // to: re-inviting an existing member is a different operation entirely.
    expect(canTransitionMembershipStatus("ACTIVE", "INVITED")).toBe(false);
    expect(canTransitionMembershipStatus("INACTIVE", "INVITED")).toBe(false);
    expect(canTransitionMembershipStatus("SUSPENDED", "INVITED")).toBe(false);
  });

  it("allows deactivation and suspension from active", () => {
    expect(canTransitionMembershipStatus("ACTIVE", "INACTIVE")).toBe(true);
    expect(canTransitionMembershipStatus("ACTIVE", "SUSPENDED")).toBe(true);
  });

  it("allows a return to active from both removed states", () => {
    expect(canTransitionMembershipStatus("INACTIVE", "ACTIVE")).toBe(true);
    expect(canTransitionMembershipStatus("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("treats a no-op transition as allowed", () => {
    expect(canTransitionMembershipStatus("ACTIVE", "ACTIVE")).toBe(true);
  });

  it("grants company access only to an active membership (PRD #14 §242)", () => {
    expect(isCompanyAccessAllowed("ACTIVE")).toBe(true);
    expect(isCompanyAccessAllowed("INVITED")).toBe(false);
    expect(isCompanyAccessAllowed("INACTIVE")).toBe(false);
    expect(isCompanyAccessAllowed("SUSPENDED")).toBe(false);
  });

  it("labels every status", () => {
    expect(Object.keys(membershipStatusLabels).sort()).toEqual([
      "ACTIVE",
      "INACTIVE",
      "INVITED",
      "SUSPENDED",
    ]);
  });
});

describe("department transitions (PRD #14 §128)", () => {
  it("moves between active and inactive", () => {
    expect(canTransitionDepartmentStatus("ACTIVE", "INACTIVE")).toBe(true);
    expect(canTransitionDepartmentStatus("INACTIVE", "ACTIVE")).toBe(true);
  });

  it("does not reach ARCHIVED through an ordinary transition", () => {
    // Archiving is its own action with its own guard — the department must be
    // empty — so it is deliberately unreachable from the status table.
    expect(canTransitionDepartmentStatus("ACTIVE", "ARCHIVED")).toBe(false);
    expect(canTransitionDepartmentStatus("INACTIVE", "ARCHIVED")).toBe(false);
  });

  it("does not leave ARCHIVED through an ordinary transition", () => {
    expect(canTransitionDepartmentStatus("ARCHIVED", "ACTIVE")).toBe(false);
  });

  it("reads archived from either the status or the timestamp", () => {
    expect(isDepartmentArchived({ status: "ARCHIVED", archivedAt: null })).toBe(true);
    expect(isDepartmentArchived({ status: "ACTIVE", archivedAt: new Date() })).toBe(true);
    expect(isDepartmentArchived({ status: "ACTIVE", archivedAt: null })).toBe(false);
  });
});
