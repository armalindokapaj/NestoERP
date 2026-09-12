import { describe, expect, it } from "vitest";

import {
  assessResidualRisk,
  assessRisk,
  calculateRiskLevel,
  calculateRiskScore,
  isRiskAxisValue,
  requiresImmediateControl,
  requiresResidualAssessment,
  residualRiskExceedsInitial,
} from "@/lib/modules/hse/hse.risk";
import {
  allowedChecklistResults,
  allowedOverallResults,
  canStartInspection,
  checklistGaps,
  closureNeedsDisposition,
  effectivePermitStatus,
  hazardClosureGaps,
  incidentClosureGaps,
  isActionOverdue,
  isPermitActivatable,
  isPermitCancellable,
  isPermitClosable,
  isReviewDue,
  isWithinValidity,
  ppeResultFor,
  requiresImmediateAction,
  requiresNewVersion,
  stopWorkReleaseGaps,
  type ChecklistAnswer,
} from "@/lib/modules/hse/hse.status";

/**
 * The HSE rules that do not need a database (PRD #22 §62–§65, §49, §73, §95,
 * §151, §160, §174).
 *
 * These are the decisions the module is built around, so they are tested
 * directly rather than through a service: what a risk score means, when an
 * inspection may pass, what stops a hazard or an incident closing, whether a
 * permit still authorises anything, and when work may restart.
 */

describe("the 5×5 risk matrix (PRD #22 §62–§65)", () => {
  it("multiplies the two axes", () => {
    expect(calculateRiskScore(4, 5)).toBe(20);
    expect(calculateRiskScore(1, 1)).toBe(1);
    expect(calculateRiskScore(3, 3)).toBe(9);
  });

  it("refuses anything off the matrix", () => {
    expect(() => calculateRiskScore(0, 3)).toThrow(RangeError);
    expect(() => calculateRiskScore(6, 3)).toThrow(RangeError);
    expect(() => calculateRiskScore(2.5, 3)).toThrow(RangeError);
    expect(isRiskAxisValue(0)).toBe(false);
    expect(isRiskAxisValue(5)).toBe(true);
  });

  /*
   * The band boundaries are where a hazard changes how fast it gets dealt with,
   * so each edge is pinned rather than sampled.
   */
  it("bands the score exactly as §64 sets out", () => {
    expect(calculateRiskLevel(1)).toBe("LOW");
    expect(calculateRiskLevel(4)).toBe("LOW");
    expect(calculateRiskLevel(5)).toBe("MEDIUM");
    expect(calculateRiskLevel(9)).toBe("MEDIUM");
    expect(calculateRiskLevel(10)).toBe("HIGH");
    expect(calculateRiskLevel(16)).toBe("HIGH");
    expect(calculateRiskLevel(17)).toBe("CRITICAL");
    expect(calculateRiskLevel(25)).toBe("CRITICAL");
  });

  it("returns the score and the level together", () => {
    expect(assessRisk(4, 5)).toEqual({ riskScore: 20, riskLevel: "CRITICAL" });
    expect(assessRisk(2, 2)).toEqual({ riskScore: 4, riskLevel: "LOW" });
  });

  it("only a critical hazard is required to carry an immediate control", () => {
    expect(requiresImmediateControl("CRITICAL")).toBe(true);
    expect(requiresImmediateControl("HIGH")).toBe(false);
  });

  it("high and critical both need the residual risk assessed before closing", () => {
    expect(requiresResidualAssessment("CRITICAL")).toBe(true);
    expect(requiresResidualAssessment("HIGH")).toBe(true);
    expect(requiresResidualAssessment("MEDIUM")).toBe(false);
  });
});

describe("residual risk (PRD #22 §71, §72)", () => {
  it("is all-or-nothing: half an assessment is no assessment", () => {
    expect(assessResidualRisk(3, undefined)).toEqual({
      residualLikelihood: null,
      residualSeverity: null,
      residualRiskScore: null,
      residualRiskLevel: null,
    });
    expect(assessResidualRisk(undefined, 3).residualRiskScore).toBeNull();
    expect(assessResidualRisk(null, null).residualRiskLevel).toBeNull();
  });

  it("scores the pair when both axes are given", () => {
    expect(assessResidualRisk(1, 5)).toEqual({
      residualLikelihood: 1,
      residualSeverity: 5,
      residualRiskScore: 5,
      residualRiskLevel: "MEDIUM",
    });
  });

  /*
   * Controls reduce risk. A residual above the initial means the axes went in
   * the wrong way round, or the "control" made things worse — which is a new
   * hazard, not a residual figure.
   */
  it("flags a residual score above the initial one", () => {
    expect(residualRiskExceedsInitial(20, 25)).toBe(true);
    expect(residualRiskExceedsInitial(20, 20)).toBe(false);
    expect(residualRiskExceedsInitial(20, 4)).toBe(false);
    expect(residualRiskExceedsInitial(20, null)).toBe(false);
  });
});

describe("checklist answers (PRD #22 §46, §49, §51)", () => {
  const base: ChecklistAnswer = {
    label: "Edge protection in place",
    required: true,
    responseType: "PASS_FAIL",
    result: "PASS",
    responseValue: null,
    note: null,
    requiresNoteOnFail: false,
  };

  it("only offers N/A where the template allowed it", () => {
    expect(allowedChecklistResults("PASS_FAIL")).toEqual(["PASS", "FAIL"]);
    expect(allowedChecklistResults("BOOLEAN")).toEqual(["PASS", "FAIL"]);
    expect(allowedChecklistResults("PASS_FAIL_NA")).toContain("NA");
  });

  it("names the unanswered required items rather than just refusing", () => {
    const gaps = checklistGaps([
      base,
      { ...base, label: "Scaffold tag current", result: null },
      { ...base, label: "Optional note", required: false, result: null },
    ]);

    expect(gaps).toEqual([{ kind: "UNANSWERED", label: "Scaffold tag current" }]);
  });

  it("wants a value on a text or number question, not just a verdict", () => {
    const gaps = checklistGaps([
      { ...base, label: "Depth in metres", responseType: "NUMBER", responseValue: "" },
    ]);
    expect(gaps).toEqual([{ kind: "MISSING_VALUE", label: "Depth in metres" }]);
  });

  it("wants a note on a failure that asked for one", () => {
    const gaps = checklistGaps([
      { ...base, result: "FAIL", requiresNoteOnFail: true, note: "   " },
    ]);
    expect(gaps).toEqual([{ kind: "MISSING_NOTE", label: base.label }]);
  });

  it("lets a failure through when the template did not ask for a note", () => {
    expect(checklistGaps([{ ...base, result: "FAIL" }])).toEqual([]);
  });

  /*
   * The rule that stops a failed fire-exit check becoming a passed inspection
   * (§49). CONDITIONAL stays available — work can continue under a control.
   */
  it("rules out PASS once a required item has failed", () => {
    expect(allowedOverallResults([base, { ...base, result: "FAIL" }])).toEqual([
      "FAIL",
      "CONDITIONAL",
    ]);
  });

  it("leaves PASS available when only an optional item failed", () => {
    const answers = [base, { ...base, required: false, result: "FAIL" as const }];
    expect(allowedOverallResults(answers)).toContain("PASS");
  });

  it("only a failed or conditional result needs a disposition to close (§55)", () => {
    expect(closureNeedsDisposition("PASS")).toBe(false);
    expect(closureNeedsDisposition("FAIL")).toBe(true);
    expect(closureNeedsDisposition("CONDITIONAL")).toBe(true);
  });

  it("lets a rejected inspection be picked back up (§54)", () => {
    expect(canStartInspection("REJECTED")).toBe(true);
    expect(canStartInspection("DRAFT")).toBe(true);
    expect(canStartInspection("APPROVED")).toBe(false);
  });
});

describe("closing a hazard (PRD #22 §73)", () => {
  const base = {
    riskLevel: "MEDIUM" as const,
    controlMeasure: "Guard rail installed",
    closureNote: "Checked and signed off",
    residualRiskScore: null as number | null,
    actions: [] as { status: "VERIFIED" | "OPEN" | "CANCELLED" }[],
  };

  it("closes cleanly when everything is in place", () => {
    expect(hazardClosureGaps(base)).toEqual([]);
  });

  it("wants the control described and the closure explained", () => {
    expect(hazardClosureGaps({ ...base, controlMeasure: "  " })).toContain("CONTROL_MEASURE");
    expect(hazardClosureGaps({ ...base, closureNote: null })).toContain("CLOSURE_NOTE");
  });

  it("wants the residual risk once it was high or critical", () => {
    expect(hazardClosureGaps({ ...base, riskLevel: "HIGH" })).toContain("RESIDUAL_RISK");
    expect(hazardClosureGaps({ ...base, riskLevel: "CRITICAL" })).toContain("RESIDUAL_RISK");
    expect(
      hazardClosureGaps({ ...base, riskLevel: "HIGH", residualRiskScore: 5 }),
    ).not.toContain("RESIDUAL_RISK");
  });

  /*
   * A hazard closed with unverified actions against it is a hazard somebody
   * filed rather than fixed.
   */
  it("is held up by an unverified action", () => {
    expect(hazardClosureGaps({ ...base, actions: [{ status: "OPEN" }] })).toContain(
      "UNVERIFIED_ACTION",
    );
  });

  it("is not held up by a cancelled one", () => {
    expect(
      hazardClosureGaps({ ...base, actions: [{ status: "CANCELLED" }, { status: "VERIFIED" }] }),
    ).toEqual([]);
  });
});

describe("closing an incident (PRD #22 §95, §363, §364)", () => {
  const base = {
    severity: "MEDIUM" as const,
    rootCause: null as string | null,
    investigationSummary: null as string | null,
    closureNote: "Dealt with",
    actions: [] as { status: "VERIFIED" | "OPEN" | "CANCELLED" }[],
  };

  /*
   * The whole difference between a serious incident and a minor one: a serious
   * one cannot close without a cause. A low one is recommended to have one but
   * not held up by it (§364).
   */
  it("wants a root cause once it is high or critical", () => {
    expect(incidentClosureGaps({ ...base, severity: "HIGH" })).toContain("ROOT_CAUSE");
    expect(incidentClosureGaps({ ...base, severity: "CRITICAL" })).toContain("ROOT_CAUSE");
    expect(incidentClosureGaps(base)).not.toContain("ROOT_CAUSE");
  });

  it("wants an investigation summary on a serious one too", () => {
    expect(incidentClosureGaps({ ...base, severity: "HIGH" })).toContain(
      "INVESTIGATION_SUMMARY",
    );
  });

  it("closes a serious one once the cause and summary are there", () => {
    expect(
      incidentClosureGaps({
        ...base,
        severity: "CRITICAL",
        rootCause: "Ladder was not tied.",
        investigationSummary: "Walked the area and spoke to those present.",
      }),
    ).toEqual([]);
  });

  it("always wants a closure note", () => {
    expect(incidentClosureGaps({ ...base, closureNote: "" })).toContain("CLOSURE_NOTE");
  });

  it("is held up by an unverified action", () => {
    expect(incidentClosureGaps({ ...base, actions: [{ status: "OPEN" }] })).toContain(
      "UNVERIFIED_ACTION",
    );
  });

  it("requires an immediate action as soon as it is serious (§362)", () => {
    expect(requiresImmediateAction("HIGH")).toBe(true);
    expect(requiresImmediateAction("MEDIUM")).toBe(false);
  });
});

describe("releasing a stop-work (PRD #22 §174)", () => {
  it("wants a reason", () => {
    expect(stopWorkReleaseGaps({ releaseReason: " ", actions: [] })).toContain(
      "RELEASE_REASON",
    );
  });

  /*
   * Releasing while the thing that stopped the job is still outstanding is how
   * the same accident happens twice in one week.
   */
  it("is blocked by an unverified critical action", () => {
    expect(
      stopWorkReleaseGaps({
        releaseReason: "Control is in",
        actions: [{ status: "PENDING_VERIFICATION", priority: "CRITICAL" }],
      }),
    ).toContain("UNRESOLVED_CRITICAL_ACTION");
  });

  it("is not blocked by a lower-priority one", () => {
    expect(
      stopWorkReleaseGaps({
        releaseReason: "Control is in",
        actions: [{ status: "OPEN", priority: "HIGH" }],
      }),
    ).toEqual([]);
  });

  it("is not blocked by a cancelled critical action", () => {
    expect(
      stopWorkReleaseGaps({
        releaseReason: "Control is in",
        actions: [{ status: "CANCELLED", priority: "CRITICAL" }],
      }),
    ).toEqual([]);
  });
});

describe("what a permit actually is (PRD #22 §150, §151, §360)", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const past = new Date("2026-06-14T12:00:00Z");
  const future = new Date("2026-06-16T12:00:00Z");

  /*
   * The clock beats the column. A permit that ran out last night authorises
   * nothing, whatever a background job has or has not done.
   */
  it("reads as expired once the window has closed", () => {
    expect(effectivePermitStatus("ACTIVE", past, now)).toBe("EXPIRED");
    expect(effectivePermitStatus("APPROVED", past, now)).toBe("EXPIRED");
    expect(effectivePermitStatus("SUSPENDED", past, now)).toBe("EXPIRED");
  });

  it("leaves a live permit alone", () => {
    expect(effectivePermitStatus("ACTIVE", future, now)).toBe("ACTIVE");
  });

  it("never revives a closed or cancelled permit", () => {
    expect(effectivePermitStatus("CLOSED", past, now)).toBe("CLOSED");
    expect(effectivePermitStatus("CANCELLED", future, now)).toBe("CANCELLED");
  });

  it("only activates inside the window it authorises", () => {
    expect(isWithinValidity(past, future, now)).toBe(true);
    expect(isWithinValidity(future, new Date("2026-06-17T12:00:00Z"), now)).toBe(false);
    expect(isWithinValidity(new Date("2026-06-01T00:00:00Z"), past, now)).toBe(false);
  });

  it("reactivates from suspended with the same grant (§153)", () => {
    expect(isPermitActivatable("APPROVED")).toBe(true);
    expect(isPermitActivatable("SUSPENDED")).toBe(true);
    expect(isPermitActivatable("DRAFT")).toBe(false);
  });

  it("closes an expired permit so the paperwork can be finished (§154)", () => {
    expect(isPermitClosable("EXPIRED")).toBe(true);
    expect(isPermitClosable("ACTIVE")).toBe(true);
    expect(isPermitClosable("DRAFT")).toBe(false);
  });

  it("cancels only before it has ever been active (§155)", () => {
    expect(isPermitCancellable("DRAFT")).toBe(true);
    expect(isPermitCancellable("APPROVED")).toBe(true);
    expect(isPermitCancellable("ACTIVE")).toBe(false);
  });
});

describe("PPE results (PRD #22 §160)", () => {
  /*
   * A check that looked at nothing is not a pass. The third state matters: a
   * blank item means "not looked at", not "fine".
   */
  it("returns no result at all when nothing was recorded", () => {
    expect(ppeResultFor({}).result).toBeNull();
    expect(ppeResultFor({ helmetOk: null, glovesOk: null }).result).toBeNull();
  });

  it("passes when every item looked at was in order", () => {
    expect(ppeResultFor({ helmetOk: true, glovesOk: true })).toEqual({
      result: "PASS",
      failed: [],
    });
  });

  it("fails on any explicit no, and names it", () => {
    const outcome = ppeResultFor({ helmetOk: true, harnessOk: false });
    expect(outcome.result).toBe("FAIL");
    expect(outcome.failed).toEqual(["harnessOk"]);
  });

  it("ignores the items that were not looked at", () => {
    expect(ppeResultFor({ helmetOk: true, glovesOk: null }).result).toBe("PASS");
  });
});

describe("risk assessment review and versioning (PRD #22 §110, §112, §359)", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  /*
   * Nothing expires by itself. An assessment that silently invalidated would
   * stop a site with no warning, so a passed review date is attention only.
   */
  it("flags an approved assessment past its review date", () => {
    expect(isReviewDue("APPROVED", new Date("2026-06-01T00:00:00Z"), now)).toBe(true);
    expect(isReviewDue("APPROVED", new Date("2026-07-01T00:00:00Z"), now)).toBe(false);
    expect(isReviewDue("APPROVED", null, now)).toBe(false);
  });

  it("does not flag a draft, whatever its review date says", () => {
    expect(isReviewDue("DRAFT", new Date("2026-01-01T00:00:00Z"), now)).toBe(false);
  });

  it("versions rather than edits once it has been approved", () => {
    expect(requiresNewVersion("APPROVED")).toBe(true);
    expect(requiresNewVersion("ARCHIVED")).toBe(true);
    expect(requiresNewVersion("DRAFT")).toBe(false);
  });
});

describe("overdue actions (PRD #22 §208)", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const yesterday = new Date("2026-06-14T12:00:00Z");

  it("is overdue while it is still open", () => {
    expect(isActionOverdue("OPEN", yesterday, now)).toBe(true);
    expect(isActionOverdue("PENDING_VERIFICATION", yesterday, now)).toBe(true);
  });

  /*
   * A finished record is never "overdue": the date it missed is history, and
   * flagging it forever would drown the list that matters.
   */
  it("stops being overdue once it is verified or cancelled", () => {
    expect(isActionOverdue("VERIFIED", yesterday, now)).toBe(false);
    expect(isActionOverdue("CANCELLED", yesterday, now)).toBe(false);
  });

  it("is never overdue without a due date", () => {
    expect(isActionOverdue("OPEN", null, now)).toBe(false);
  });
});
