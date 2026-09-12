import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  balances,
  imbalance,
  quantity,
  quantityString,
  releasableQuantity,
  sum,
} from "@/lib/modules/qaqc/qaqc.quantity";
import {
  allowedOverallResults,
  allowsInventoryPosting,
  allowsNotApplicable,
  checklistProblems,
  closesWithoutFollowUp,
  hasQualityEffect,
  isActionCompletable,
  isActionVerifiable,
  isDefectCloseable,
  isDefectResolvable,
  isInspectionCancellable,
  isInspectionCloseable,
  isInspectionDecidable,
  isInspectionEditable,
  isInspectionExecutable,
  isInspectionReopenable,
  isInspectionSubmittable,
  isNcrCloseable,
  isTemplateUsable,
  isVerdictResponse,
  ncrClosureGaps,
  requiresDecisionNote,
} from "@/lib/modules/qaqc/qaqc.status";
import {
  correctiveActionSchema,
  inspectionSchema,
  materialDecisionSchema,
  requestSchema,
  submitInspectionSchema,
  templateSchema,
} from "@/lib/modules/qaqc/qaqc.schema";
import { reinspectionLabel } from "@/lib/modules/qaqc/qaqc.numbering";

/**
 * QA/QC logic, tested without a database (PRD #21 §377 equivalent).
 *
 * The three rules that make this module more than a list of records:
 * a failed check cannot be called a pass, an NCR cannot close without a cause
 * and a verified fix, and the material equation has to balance exactly.
 */

describe("decimal quantities (PRD #21 §91, §220)", () => {
  it("adds without floating-point drift", () => {
    const total = quantity("0.1").plus(quantity("0.2"));
    expect(total.equals(new Prisma.Decimal("0.3"))).toBe(true);
  });

  it("balances the material equation exactly", () => {
    const input = {
      inspected: quantity("100"),
      accepted: quantity("70.5"),
      rejected: quantity("19.5"),
      conditional: quantity("10"),
    };
    expect(balances(input)).toBe(true);
    expect(imbalance(input).isZero()).toBe(true);
  });

  it("catches a decision that has silently lost material", () => {
    const input = {
      inspected: quantity("100"),
      accepted: quantity("70"),
      rejected: quantity("19"),
      conditional: quantity("10"),
    };
    expect(balances(input)).toBe(false);
    expect(imbalance(input).toString()).toBe("-1");
  });

  it("balances at four decimal places, where a float would not", () => {
    const input = {
      inspected: quantity("1"),
      accepted: quantity("0.3333"),
      rejected: quantity("0.3333"),
      conditional: quantity("0.3334"),
    };
    expect(balances(input)).toBe(true);
  });

  it("releases accepted and conditional, never rejected (§96, §97)", () => {
    const released = releasableQuantity({
      inspected: quantity("100"),
      accepted: quantity("70"),
      rejected: quantity("20"),
      conditional: quantity("10"),
    });
    expect(released.toString()).toBe("80");
  });

  it("trims trailing zeros without rounding", () => {
    expect(quantityString(quantity("42.0000"))).toBe("42");
    expect(quantityString(quantity("0.0001"))).toBe("0.0001");
    expect(quantityString(null)).toBe("0");
    expect(quantityString(sum([null, quantity("5")]))).toBe("5");
  });
});

describe("checklist completeness (PRD #21 §75, §57)", () => {
  const base = {
    required: true,
    responseType: "PASS_FAIL" as const,
    result: null,
    responseValue: null,
    note: null,
    requiresEvidenceOnFail: false,
  };

  it("reports a required check nobody answered", () => {
    const problems = checklistProblems([{ ...base, label: "Formwork braced" }]);
    expect(problems).toEqual([{ kind: "UNANSWERED", label: "Formwork braced" }]);
  });

  it("lets an optional check stay blank", () => {
    const problems = checklistProblems([
      { ...base, required: false, label: "Optional check" },
    ]);
    expect(problems).toEqual([]);
  });

  it("reports a failure that needed evidence and got none", () => {
    const problems = checklistProblems([
      { ...base, result: "FAIL", requiresEvidenceOnFail: true, label: "Cover" },
    ]);
    expect(problems).toEqual([{ kind: "MISSING_NOTE", label: "Cover" }]);
  });

  it("accepts a failure that was explained", () => {
    const problems = checklistProblems([
      {
        ...base,
        result: "FAIL",
        requiresEvidenceOnFail: true,
        note: "Measured 28mm against a 35mm minimum.",
        label: "Cover",
      },
    ]);
    expect(problems).toEqual([]);
  });

  it("treats a written answer as the answer for a non-verdict check", () => {
    const measured = {
      ...base,
      responseType: "NUMBER" as const,
      responseValue: "38",
      label: "Cover",
    };
    expect(checklistProblems([measured])).toEqual([]);

    const blank = { ...measured, responseValue: "   " };
    expect(checklistProblems([blank])).toEqual([
      { kind: "UNANSWERED", label: "Cover" },
    ]);
  });
});

describe("result consistency (PRD #21 §76, §77, §78)", () => {
  const passing = {
    required: true,
    responseType: "PASS_FAIL" as const,
    result: "PASS" as const,
    responseValue: null,
    note: null,
    requiresEvidenceOnFail: false,
  };

  it("offers every verdict when nothing required failed", () => {
    expect(allowedOverallResults([passing])).toEqual(["PASS", "FAIL", "CONDITIONAL"]);
  });

  it("withdraws PASS once a required check failed", () => {
    const allowed = allowedOverallResults([{ ...passing, result: "FAIL" }]);
    expect(allowed).toEqual(["FAIL", "CONDITIONAL"]);
    expect(allowed).not.toContain("PASS");
  });

  it("ignores an optional failure for the overall verdict", () => {
    const allowed = allowedOverallResults([
      passing,
      { ...passing, required: false, result: "FAIL" },
    ]);
    expect(allowed).toContain("PASS");
  });

  it("requires a written condition for a conditional acceptance", () => {
    expect(requiresDecisionNote("CONDITIONAL")).toBe(true);
    expect(requiresDecisionNote("PASS")).toBe(false);
    expect(requiresDecisionNote("FAIL")).toBe(false);

    const parsed = submitInspectionSchema.safeParse({ result: "CONDITIONAL" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.decisionNote?.[0]).toMatch(/condition is/i);
    }
  });

  it("closes a pass on its own and asks for follow-up on anything else", () => {
    expect(closesWithoutFollowUp("PASS")).toBe(true);
    expect(closesWithoutFollowUp("FAIL")).toBe(false);
    expect(closesWithoutFollowUp("CONDITIONAL")).toBe(false);
  });
});

describe("inspection lifecycle (PRD #21 §63, §79–§88)", () => {
  it("edits only a draft, executes only before submission", () => {
    expect(isInspectionEditable("DRAFT")).toBe(true);
    expect(isInspectionEditable("IN_PROGRESS")).toBe(false);

    expect(isInspectionExecutable("DRAFT")).toBe(true);
    expect(isInspectionExecutable("IN_PROGRESS")).toBe(true);
    expect(isInspectionExecutable("PENDING_APPROVAL")).toBe(false);
  });

  it("keeps submitting, deciding and closing in order", () => {
    expect(isInspectionSubmittable("IN_PROGRESS")).toBe(true);
    expect(isInspectionDecidable("PENDING_APPROVAL")).toBe(true);
    expect(isInspectionCloseable("APPROVED")).toBe(true);

    // Never two of them at once.
    for (const status of [
      "DRAFT",
      "IN_PROGRESS",
      "PENDING_APPROVAL",
      "APPROVED",
      "REJECTED",
      "CLOSED",
      "CANCELLED",
    ] as const) {
      const gates = [
        isInspectionSubmittable(status),
        isInspectionDecidable(status),
        isInspectionCloseable(status),
      ].filter(Boolean);
      expect(gates.length).toBeLessThanOrEqual(1);
    }
  });

  it("cancels only before submission — afterwards it is rejected instead (§87)", () => {
    expect(isInspectionCancellable("DRAFT")).toBe(true);
    expect(isInspectionCancellable("IN_PROGRESS")).toBe(true);
    expect(isInspectionCancellable("PENDING_APPROVAL")).toBe(false);
  });

  it("reopens only a closed record, and prefers reinspection (§88)", () => {
    expect(isInspectionReopenable("CLOSED")).toBe(true);
    expect(isInspectionReopenable("APPROVED")).toBe(false);
  });

  it("gives a cancelled inspection no quality effect (§87)", () => {
    expect(hasQualityEffect("APPROVED")).toBe(true);
    expect(hasQualityEffect("CLOSED")).toBe(true);
    expect(hasQualityEffect("CANCELLED")).toBe(false);
    expect(hasQualityEffect("PENDING_APPROVAL")).toBe(false);
  });

  it("names a reinspection against its parent (§156)", () => {
    expect(reinspectionLabel("INS-2026-0031", 2)).toBe("INS-2026-0031 R2");
  });
});

describe("NCR closure (PRD #21 §136, §137)", () => {
  const verified = [{ status: "VERIFIED" as const }];

  it("needs a root cause", () => {
    const gaps = ncrClosureGaps({
      rootCause: null,
      closureNote: "Closed.",
      actions: verified,
      severity: "LOW",
    });
    expect(gaps).toContain("ROOT_CAUSE");
  });

  it("needs at least one corrective action", () => {
    const gaps = ncrClosureGaps({
      rootCause: "A cause.",
      closureNote: null,
      actions: [],
      severity: "LOW",
    });
    expect(gaps).toContain("CORRECTIVE_ACTION");
  });

  it("needs every action verified", () => {
    const gaps = ncrClosureGaps({
      rootCause: "A cause.",
      closureNote: null,
      actions: [{ status: "VERIFIED" }, { status: "IN_PROGRESS" }],
      severity: "LOW",
    });
    expect(gaps).toContain("UNVERIFIED_ACTION");
  });

  it("ignores a cancelled action, which no longer blocks", () => {
    const gaps = ncrClosureGaps({
      rootCause: "A cause.",
      closureNote: null,
      actions: [{ status: "VERIFIED" }, { status: "CANCELLED" }],
      severity: "LOW",
    });
    expect(gaps).toEqual([]);
  });

  it("asks a critical non-conformance for a written closure note (§137)", () => {
    const gaps = ncrClosureGaps({
      rootCause: "A cause.",
      closureNote: null,
      actions: verified,
      severity: "CRITICAL",
    });
    expect(gaps).toEqual(["CLOSURE_NOTE"]);

    const satisfied = ncrClosureGaps({
      rootCause: "A cause.",
      closureNote: "Closed after re-inspection.",
      actions: verified,
      severity: "CRITICAL",
    });
    expect(satisfied).toEqual([]);
  });

  it("closes only once its closure has been approved", () => {
    expect(isNcrCloseable("APPROVED_FOR_CLOSE")).toBe(true);
    expect(isNcrCloseable("PENDING_APPROVAL")).toBe(false);
    expect(isNcrCloseable("OPEN")).toBe(false);
  });
});

describe("two pairs of eyes (PRD #21 §119, §147)", () => {
  it("separates resolving a defect from closing it", () => {
    expect(isDefectResolvable("OPEN")).toBe(true);
    expect(isDefectCloseable("OPEN")).toBe(false);

    expect(isDefectResolvable("RESOLVED")).toBe(false);
    expect(isDefectCloseable("RESOLVED")).toBe(true);
  });

  it("separates completing an action from verifying it", () => {
    expect(isActionCompletable("IN_PROGRESS")).toBe(true);
    expect(isActionVerifiable("IN_PROGRESS")).toBe(false);

    expect(isActionCompletable("PENDING_VERIFICATION")).toBe(false);
    expect(isActionVerifiable("PENDING_VERIFICATION")).toBe(true);
  });
});

describe("templates and responses (PRD #21 §52, §55)", () => {
  it("uses only an active template", () => {
    expect(isTemplateUsable("ACTIVE")).toBe(true);
    expect(isTemplateUsable("INACTIVE")).toBe(false);
    expect(isTemplateUsable("ARCHIVED")).toBe(false);
  });

  it("knows which response types carry a verdict", () => {
    expect(isVerdictResponse("PASS_FAIL")).toBe(true);
    expect(isVerdictResponse("PASS_FAIL_NA")).toBe(true);
    // A measurement is evidence, not a verdict: somebody still has to judge it.
    expect(isVerdictResponse("NUMBER")).toBe(false);
    expect(isVerdictResponse("TEXT")).toBe(false);
    expect(isVerdictResponse("BOOLEAN")).toBe(false);
  });

  it("offers N/A only where the check allows it", () => {
    expect(allowsNotApplicable("PASS_FAIL_NA")).toBe(true);
    expect(allowsNotApplicable("PASS_FAIL")).toBe(false);
  });
});

describe("material release (PRD #21 §102, §103)", () => {
  it("lets Inventory post against a live release only", () => {
    expect(allowsInventoryPosting("RELEASED")).toBe(true);
    expect(allowsInventoryPosting("PARTIALLY_RELEASED")).toBe(true);
    expect(allowsInventoryPosting("HELD")).toBe(false);
    expect(allowsInventoryPosting("REJECTED")).toBe(false);
    expect(allowsInventoryPosting("REVOKED")).toBe(false);
  });
});

describe("validation (PRD #21 §233)", () => {
  it("requires a project on a work inspection (§106)", () => {
    const parsed = inspectionSchema.safeParse({
      inspectionType: "WORK",
      assignedInspectorMemberId: "m1",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.projectId?.[0]).toMatch(/needs a project/i);
    }
  });

  it("requires a delivery on a material inspection (§41)", () => {
    const parsed = inspectionSchema.safeParse({
      inspectionType: "MATERIAL",
      assignedInspectorMemberId: "m1",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.goodsReceiptId?.[0]).toMatch(/delivery/i);
    }
  });

  it("refuses a required-by date before the request was raised", () => {
    const parsed = requestSchema.safeParse({
      title: "A request",
      inspectionType: "GENERAL",
      requestedDate: "2026-09-10",
      requiredByDate: "2026-09-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a corrective action with no parent (§221)", () => {
    const parsed = correctiveActionSchema.safeParse({
      title: "An action",
      description: "Something to do.",
      assignedToMemberId: "m1",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.ncrId?.[0]).toMatch(/hang off/i);
    }
  });

  it("accepts a corrective action against any one parent", () => {
    for (const key of ["ncrId", "defectId", "inspectionId"]) {
      const parsed = correctiveActionSchema.safeParse({
        title: "An action",
        description: "Something to do.",
        assignedToMemberId: "m1",
        [key]: "parent-id",
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("refuses a template with no checks (§50)", () => {
    const parsed = templateSchema.safeParse({
      code: "T-1",
      name: "Empty",
      inspectionType: "GENERAL",
      items: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a material decision that does not balance (§91)", () => {
    const parsed = materialDecisionSchema.safeParse({
      goodsReceiptItemId: "line",
      inspectedQuantity: "10",
      acceptedQuantity: "5",
      rejectedQuantity: "2",
      conditionalQuantity: "2",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a decision that balances to four decimal places", () => {
    const parsed = materialDecisionSchema.safeParse({
      goodsReceiptItemId: "line",
      inspectedQuantity: "1",
      acceptedQuantity: "0.3333",
      rejectedQuantity: "0.3333",
      conditionalQuantity: "0.3334",
    });
    expect(parsed.success).toBe(true);
  });

  it("never lets a schema set a status or a result directly", () => {
    const parsed = inspectionSchema.safeParse({
      inspectionType: "GENERAL",
      assignedInspectorMemberId: "m1",
      status: "APPROVED",
      result: "PASS",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("status" in parsed.data).toBe(false);
      expect("result" in parsed.data).toBe(false);
    }
  });
});
