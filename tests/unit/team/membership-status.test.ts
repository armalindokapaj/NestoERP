import { describe, expect, it } from "vitest";

import {
  canTransitionMembershipStatus,
  isCompanyAccessAllowed,
  membershipStatusLabels,
} from "@/lib/modules/team/membership.status";

/** Membership lifecycle rules (PRD #14 §109, §110). Department status is E-13's since (ADR 0003). */
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
