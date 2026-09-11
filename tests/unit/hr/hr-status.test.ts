import { describe, expect, it } from "vitest";

import {
  acceptsTimes,
  attendanceStatusLabels,
  blocksOverlap,
  canTransitionEmployment,
  canTransitionLeave,
  consumesBalance,
  countsAsWorked,
  countsInHeadcount,
  isBalanceTracked,
  isEmploymentLive,
  isException,
  isLeaveEditable,
  isLeaveSubmittable,
  isPlannable,
  leaveStatusLabels,
  leaveTypeLabels,
} from "@/lib/modules/hr/hr.status";

/** HR lifecycle rules (PRD #16 §55, §72, §99, §342). */
describe("employment transitions (PRD #16 §55)", () => {
  it("lets planned employment start, and active employment pause or end", () => {
    expect(canTransitionEmployment("PLANNED", "ACTIVE")).toBe(true);
    expect(canTransitionEmployment("ACTIVE", "ON_LEAVE")).toBe(true);
    expect(canTransitionEmployment("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionEmployment("ACTIVE", "ENDED")).toBe(true);
  });

  it("never reopens ended employment by a status change (PRD #16 §56)", () => {
    // Coming back is a rehire: it needs a new start date and must clear the old
    // end date, or the record claims somebody both left and is working.
    expect(canTransitionEmployment("ENDED", "ACTIVE")).toBe(false);
    expect(canTransitionEmployment("ENDED", "PLANNED")).toBe(false);
    expect(canTransitionEmployment("ENDED", "ON_LEAVE")).toBe(false);
  });

  it("never sends live employment back to planned", () => {
    expect(canTransitionEmployment("ACTIVE", "PLANNED")).toBe(false);
    expect(canTransitionEmployment("ON_LEAVE", "PLANNED")).toBe(false);
  });

  it("treats a no-op transition as allowed", () => {
    expect(canTransitionEmployment("ACTIVE", "ACTIVE")).toBe(true);
  });

  it("counts active and on-leave employment as headcount (PRD #16 §142)", () => {
    expect(countsInHeadcount("ACTIVE")).toBe(true);
    expect(countsInHeadcount("ON_LEAVE")).toBe(true);
    expect(countsInHeadcount("SUSPENDED")).toBe(false);
    expect(countsInHeadcount("PLANNED")).toBe(false);
    expect(countsInHeadcount("ENDED")).toBe(false);
  });

  it("treats employment as live whatever the person is doing today", () => {
    expect(isEmploymentLive("ON_LEAVE")).toBe(true);
    expect(isEmploymentLive("SUSPENDED")).toBe(false);
  });
});

describe("leave transitions (PRD #16 §72)", () => {
  it("moves a draft to pending, and a pending request to a decision", () => {
    expect(canTransitionLeave("DRAFT", "PENDING")).toBe(true);
    expect(canTransitionLeave("PENDING", "APPROVED")).toBe(true);
    expect(canTransitionLeave("PENDING", "REJECTED")).toBe(true);
  });

  it("lets a rejected request be corrected and sent again", () => {
    expect(canTransitionLeave("REJECTED", "DRAFT")).toBe(true);
    expect(isLeaveEditable("REJECTED")).toBe(true);
    expect(isLeaveSubmittable("REJECTED")).toBe(true);
  });

  it("never decides a request that was never submitted", () => {
    expect(canTransitionLeave("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionLeave("DRAFT", "REJECTED")).toBe(false);
  });

  it("allows approved leave to be cancelled, but nothing else (PRD #16 §89)", () => {
    expect(canTransitionLeave("APPROVED", "CANCELLED")).toBe(true);
    expect(canTransitionLeave("APPROVED", "REJECTED")).toBe(false);
    expect(canTransitionLeave("APPROVED", "DRAFT")).toBe(false);
  });

  it("makes cancellation final", () => {
    expect(canTransitionLeave("CANCELLED", "DRAFT")).toBe(false);
    expect(canTransitionLeave("CANCELLED", "PENDING")).toBe(false);
  });

  it("refuses to edit a request that is with an approver", () => {
    expect(isLeaveEditable("PENDING")).toBe(false);
    expect(isLeaveEditable("APPROVED")).toBe(false);
  });

  it("blocks the calendar for pending and approved leave alike (PRD #16 §83)", () => {
    // A pending request has to hold its dates, or two overlapping requests can
    // both be approved by two different people.
    expect(blocksOverlap("PENDING")).toBe(true);
    expect(blocksOverlap("APPROVED")).toBe(true);
    expect(blocksOverlap("DRAFT")).toBe(false);
    expect(blocksOverlap("REJECTED")).toBe(false);
    expect(blocksOverlap("CANCELLED")).toBe(false);
  });

  it("draws down a balance only once the leave is approved (PRD #16 §80)", () => {
    expect(consumesBalance("APPROVED")).toBe(true);
    expect(consumesBalance("PENDING")).toBe(false);
  });
});

describe("leave balance scope (PRD #16 §84, §85)", () => {
  it("caps annual leave and nothing else in V0.1", () => {
    expect(isBalanceTracked("ANNUAL")).toBe(true);
    expect(isBalanceTracked("SICK")).toBe(false);
    expect(isBalanceTracked("PARENTAL")).toBe(false);
    expect(isBalanceTracked("UNPAID")).toBe(false);
    expect(isBalanceTracked("OTHER")).toBe(false);
  });

  it("names every leave type and status it can store", () => {
    expect(Object.keys(leaveTypeLabels)).toHaveLength(5);
    expect(Object.keys(leaveStatusLabels)).toHaveLength(5);
  });
});

describe("attendance rules (PRD #16 §104, §105, §115)", () => {
  it("carries times only for statuses somebody actually worked", () => {
    expect(acceptsTimes("PRESENT")).toBe(true);
    expect(acceptsTimes("REMOTE")).toBe(true);
    expect(acceptsTimes("ABSENT")).toBe(false);
    expect(acceptsTimes("ON_LEAVE")).toBe(false);
    expect(acceptsTimes("HOLIDAY")).toBe(false);
    expect(acceptsTimes("OFF")).toBe(false);
  });

  it("plans only what can be known in advance (PRD #16 §104)", () => {
    // "Present next Tuesday" is not something anybody knows; a holiday is.
    expect(isPlannable("HOLIDAY")).toBe(true);
    expect(isPlannable("OFF")).toBe(true);
    expect(isPlannable("PRESENT")).toBe(false);
    expect(isPlannable("ON_LEAVE")).toBe(false);
  });

  it("counts present and remote days as worked (PRD #16 §114)", () => {
    expect(countsAsWorked("PRESENT")).toBe(true);
    expect(countsAsWorked("REMOTE")).toBe(true);
    expect(countsAsWorked("ON_LEAVE")).toBe(false);
  });

  it("flags an absence, and a day nobody checked out of", () => {
    const at = (time: string) => new Date(`2026-09-14T${time}:00.000Z`);

    expect(isException({ status: "ABSENT", checkIn: null, checkOut: null })).toBe(true);
    expect(isException({ status: "PRESENT", checkIn: at("09:00"), checkOut: null })).toBe(true);
    expect(isException({ status: "PRESENT", checkIn: at("09:00"), checkOut: at("17:00") })).toBe(
      false,
    );
  });

  it("does not flag a day that never had times to begin with", () => {
    expect(isException({ status: "HOLIDAY", checkIn: null, checkOut: null })).toBe(false);
    expect(isException({ status: "ON_LEAVE", checkIn: null, checkOut: null })).toBe(false);
    expect(isException({ status: "PRESENT", checkIn: null, checkOut: null })).toBe(false);
  });

  it("names every attendance status it can store", () => {
    expect(Object.keys(attendanceStatusLabels)).toHaveLength(6);
  });
});
