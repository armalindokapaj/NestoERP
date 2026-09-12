import { describe, expect, it } from "vitest";

import {
  CONTRACT_STATUSES,
  EXPIRING_SOON_DAYS,
  acceptsAmendments,
  acceptsObligations,
  arePartiesEditable,
  canTransitionContractStatus,
  contractEditMode,
  daysBetween,
  getEffectiveContractStatus,
  isContractArchivable,
  isExpiringSoon,
  isPartyRemovable,
  isRenewalNoticeDue,
  renewalAlertDate,
} from "@/lib/modules/contracts/contracts/contract.status";
import {
  canTransitionAmendmentStatus,
  isAmendmentEditable,
  isAmendmentInFlight,
} from "@/lib/modules/contracts/amendments/amendment.status";
import {
  daysOverdue,
  isObligationOverdue,
  obligationDueBucket,
} from "@/lib/modules/contracts/obligations/obligation.status";

/**
 * Contract derivation rules (PRD #18 §293–§295, §191, §193).
 *
 * Pure functions, no database: these are the rules the whole module leans on,
 * and they are worth testing at the only level where every branch is cheap to
 * reach.
 *
 * The load-bearing idea is that expiry and overdue are **facts about today**
 * rather than stored flags. A stored one is wrong every night at midnight
 * (PRD #18 §123, §152).
 */

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day("2026-06-15");

describe("contract status transitions (PRD #18 §191, §192)", () => {
  it("moves forward through the lifecycle", () => {
    expect(canTransitionContractStatus("DRAFT", "IN_REVIEW")).toBe(true);
    expect(canTransitionContractStatus("IN_REVIEW", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionContractStatus("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionContractStatus("APPROVED", "SENT")).toBe(true);
    expect(canTransitionContractStatus("SENT", "SIGNED")).toBe(true);
    expect(canTransitionContractStatus("SIGNED", "ACTIVE")).toBe(true);
  });

  it("refuses a jump that skips a state", () => {
    expect(canTransitionContractStatus("DRAFT", "SIGNED")).toBe(false);
    expect(canTransitionContractStatus("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionContractStatus("APPROVED", "ACTIVE")).toBe(false);
  });

  it("terminates a contract in force rather than cancelling it (PRD #18 §128)", () => {
    expect(canTransitionContractStatus("ACTIVE", "CANCELLED")).toBe(false);
    expect(canTransitionContractStatus("ACTIVE", "TERMINATED")).toBe(true);
    // An agreement can be ended after signature but before it takes effect.
    expect(canTransitionContractStatus("SIGNED", "TERMINATED")).toBe(true);
  });

  it("gives the archive no outgoing edge (restore returns the prior status)", () => {
    for (const status of CONTRACT_STATUSES) {
      expect(canTransitionContractStatus("ARCHIVED", status)).toBe(false);
    }
  });

  it("sends a rejected approval back to review, not to draft (PRD #18 §114)", () => {
    expect(canTransitionContractStatus("PENDING_APPROVAL", "IN_REVIEW")).toBe(true);
  });
});

describe("what may still be changed (PRD #18 §105–§107, §145)", () => {
  it("opens the whole agreement only while it is being written", () => {
    expect(contractEditMode("DRAFT")).toBe("FULL");
    expect(contractEditMode("IN_REVIEW")).toBe("FULL");
  });

  it("narrows to metadata once it is approved (PRD #18 §106)", () => {
    for (const status of ["APPROVED", "SENT", "SIGNED", "ACTIVE"] as const) {
      expect(contractEditMode(status)).toBe("METADATA");
    }
  });

  it("closes a finished or undecided record entirely", () => {
    for (const status of ["PENDING_APPROVAL", "EXPIRED", "TERMINATED", "CANCELLED", "ARCHIVED"] as const) {
      expect(contractEditMode(status)).toBe("NONE");
    }
  });

  it("freezes the parties when the agreement freezes (PRD #18 §145, §146)", () => {
    expect(arePartiesEditable("DRAFT")).toBe(true);
    expect(arePartiesEditable("IN_REVIEW")).toBe(true);
    expect(arePartiesEditable("ACTIVE")).toBe(false);
    // Removal is stricter still: only while it is a draft.
    expect(isPartyRemovable("DRAFT")).toBe(true);
    expect(isPartyRemovable("IN_REVIEW")).toBe(false);
  });

  it("takes amendments only after drafting, and obligations nearly always", () => {
    expect(acceptsAmendments("DRAFT")).toBe(false);
    expect(acceptsAmendments("ACTIVE")).toBe(true);
    expect(acceptsObligations("DRAFT")).toBe(true);
    expect(acceptsObligations("ACTIVE")).toBe(true);
    expect(acceptsObligations("ARCHIVED")).toBe(false);
    expect(acceptsObligations("CANCELLED")).toBe(false);
  });

  it("archives only what is finished (PRD #18 §134)", () => {
    expect(isContractArchivable("DRAFT")).toBe(true);
    expect(isContractArchivable("EXPIRED")).toBe(true);
    expect(isContractArchivable("TERMINATED")).toBe(true);
    expect(isContractArchivable("CANCELLED")).toBe(true);
    expect(isContractArchivable("ACTIVE")).toBe(false);
    expect(isContractArchivable("PENDING_APPROVAL")).toBe(false);
  });
});

describe("expiry is derived from today (PRD #18 §123, §193, §426)", () => {
  it("reads an overdue active contract as expired even if the status lags", () => {
    const status = getEffectiveContractStatus(
      { status: "ACTIVE", expiryDate: day("2026-06-01") },
      TODAY,
    );
    // A list that showed "Active — expired 14 days ago" would be lying in one
    // of its two columns.
    expect(status).toBe("EXPIRED");
  });

  it("leaves a contract active on its expiry day", () => {
    expect(
      getEffectiveContractStatus({ status: "ACTIVE", expiryDate: TODAY }, TODAY),
    ).toBe("ACTIVE");
  });

  it("never invents an expiry for a contract that has no date (PRD #18 §491)", () => {
    expect(getEffectiveContractStatus({ status: "ACTIVE", expiryDate: null }, TODAY)).toBe("ACTIVE");
  });

  it("does not re-derive a contract that is already closed", () => {
    for (const status of ["TERMINATED", "CANCELLED", "ARCHIVED", "DRAFT"] as const) {
      expect(getEffectiveContractStatus({ status, expiryDate: day("2020-01-01") }, TODAY)).toBe(
        status,
      );
    }
  });

  it("flags expiring-soon only inside the horizon (PRD #18 §75)", () => {
    const inside = day("2026-07-15");
    const outside = day("2027-01-01");

    expect(isExpiringSoon({ status: "ACTIVE", expiryDate: inside }, TODAY)).toBe(true);
    expect(isExpiringSoon({ status: "ACTIVE", expiryDate: outside }, TODAY)).toBe(false);
    // Already past is not "soon".
    expect(isExpiringSoon({ status: "ACTIVE", expiryDate: day("2026-06-01") }, TODAY)).toBe(false);
    // A draft is not expiring; it has not started.
    expect(isExpiringSoon({ status: "DRAFT", expiryDate: inside }, TODAY)).toBe(false);
    expect(EXPIRING_SOON_DAYS).toBe(90);
  });

  it("counts days symmetrically across a month boundary", () => {
    expect(daysBetween(day("2026-06-15"), day("2026-07-15"))).toBe(30);
    expect(daysBetween(day("2026-07-15"), day("2026-06-15"))).toBe(-30);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });
});

describe("renewal notice is expiry minus notice (PRD #18 §74, §194)", () => {
  it("derives the alert date rather than storing it", () => {
    const alert = renewalAlertDate({
      status: "ACTIVE",
      expiryDate: day("2026-12-31"),
      renewalType: "MANUAL",
      renewalNoticeDays: 60,
    });
    expect(alert!.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("has no alert date for a contract that does not renew", () => {
    expect(
      renewalAlertDate({
        status: "ACTIVE",
        expiryDate: day("2026-12-31"),
        renewalType: "NONE",
        renewalNoticeDays: 30,
      }),
    ).toBeNull();
  });

  it("has no alert date for an evergreen with no expiry (PRD #18 §73)", () => {
    expect(
      renewalAlertDate({
        status: "ACTIVE",
        expiryDate: null,
        renewalType: "EVERGREEN",
        renewalNoticeDays: 30,
      }),
    ).toBeNull();
  });

  it("is due between the notice date and expiry, and not after", () => {
    const contract = {
      status: "ACTIVE" as const,
      expiryDate: day("2026-07-01"),
      renewalType: "MANUAL" as const,
      renewalNoticeDays: 30,
    };
    // Notice date is 2026-06-01; today is the 15th, so it is due.
    expect(isRenewalNoticeDue(contract, TODAY)).toBe(true);
    // Before the notice window opens.
    expect(isRenewalNoticeDue(contract, day("2026-05-01"))).toBe(false);
    // After the contract has already expired there is nothing to renew.
    expect(isRenewalNoticeDue(contract, day("2026-07-02"))).toBe(false);
  });
});

describe("obligations are overdue by derivation (PRD #18 §152, §295)", () => {
  it("is overdue only while open and past due", () => {
    const past = day("2026-06-01");
    expect(isObligationOverdue({ status: "OPEN", dueDate: past }, TODAY)).toBe(true);
    expect(isObligationOverdue({ status: "COMPLETED", dueDate: past }, TODAY)).toBe(false);
    expect(isObligationOverdue({ status: "CANCELLED", dueDate: past }, TODAY)).toBe(false);
    expect(isObligationOverdue({ status: "OPEN", dueDate: null }, TODAY)).toBe(false);
  });

  it("is not overdue on the due date itself", () => {
    expect(isObligationOverdue({ status: "OPEN", dueDate: TODAY }, TODAY)).toBe(false);
    expect(daysOverdue({ status: "OPEN", dueDate: TODAY }, TODAY)).toBe(0);
  });

  it("counts whole days late", () => {
    expect(daysOverdue({ status: "OPEN", dueDate: day("2026-06-01") }, TODAY)).toBe(14);
    expect(daysOverdue({ status: "COMPLETED", dueDate: day("2026-06-01") }, TODAY)).toBe(0);
  });

  it("buckets by due date for the attention list (PRD #18 §338)", () => {
    expect(obligationDueBucket({ status: "OPEN", dueDate: day("2026-06-01") }, TODAY)).toBe("OVERDUE");
    expect(obligationDueBucket({ status: "OPEN", dueDate: TODAY }, TODAY)).toBe("DUE_TODAY");
    expect(obligationDueBucket({ status: "OPEN", dueDate: day("2026-06-20") }, TODAY)).toBe("NEXT_7_DAYS");
    expect(obligationDueBucket({ status: "OPEN", dueDate: day("2026-07-10") }, TODAY)).toBe("NEXT_30_DAYS");
    expect(obligationDueBucket({ status: "OPEN", dueDate: day("2027-01-01") }, TODAY)).toBe("LATER");
    expect(obligationDueBucket({ status: "OPEN", dueDate: null }, TODAY)).toBe("NO_DUE_DATE");
    // A closed obligation with a past date is history, not an alarm.
    expect(obligationDueBucket({ status: "COMPLETED", dueDate: day("2026-06-01") }, TODAY)).toBe("LATER");
  });
});

describe("amendment lifecycle (PRD #18 §162, §177, §294)", () => {
  it("walks draft → approval → signature → active", () => {
    expect(canTransitionAmendmentStatus("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionAmendmentStatus("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionAmendmentStatus("APPROVED", "SENT")).toBe(true);
    expect(canTransitionAmendmentStatus("SENT", "SIGNED")).toBe(true);
    expect(canTransitionAmendmentStatus("SIGNED", "ACTIVE")).toBe(true);
  });

  it("refuses to activate an amendment nobody has signed", () => {
    expect(canTransitionAmendmentStatus("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionAmendmentStatus("APPROVED", "ACTIVE")).toBe(false);
  });

  it("makes an active amendment immutable (PRD #18 §177)", () => {
    expect(isAmendmentEditable("DRAFT")).toBe(true);
    expect(isAmendmentEditable("ACTIVE")).toBe(false);
    expect(isAmendmentEditable("SIGNED")).toBe(false);
  });

  it("knows which amendments are still in flight (PRD #18 §178)", () => {
    expect(isAmendmentInFlight("DRAFT")).toBe(true);
    expect(isAmendmentInFlight("PENDING_APPROVAL")).toBe(true);
    expect(isAmendmentInFlight("ACTIVE")).toBe(false);
    expect(isAmendmentInFlight("CANCELLED")).toBe(false);
  });
});
