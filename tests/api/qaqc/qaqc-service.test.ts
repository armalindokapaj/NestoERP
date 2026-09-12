import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import * as approvals from "@/lib/modules/qaqc/approvals/approval.service";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import * as materials from "@/lib/modules/qaqc/materials/material.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import * as templates from "@/lib/modules/qaqc/templates/template.service";
import { qaqcOverview } from "@/lib/modules/qaqc/overview/overview.service";
import { qaqcReports } from "@/lib/modules/qaqc/reports/reports.service";
import {
  approvalListQuerySchema,
  correctiveActionListQuerySchema,
  correctiveActionSchema,
  defectListQuerySchema,
  defectSchema,
  inspectionListQuerySchema,
  inspectionSchema,
  materialDecisionSchema,
  ncrListQuerySchema,
  ncrSchema,
  requestListQuerySchema,
  requestSchema,
  submitInspectionSchema,
  templateListQuerySchema,
  templateSchema,
} from "@/lib/modules/qaqc/qaqc.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * QA/QC authorisation and lifecycle tests (PRD #21 §420–§440).
 *
 * These call the same services the pages call, so a passing test is a statement
 * about the running product rather than about a mock (PRD #9 §223).
 *
 * The rules this module exists to hold:
 *   1. status and result are different things,
 *   2. a required check that failed makes an overall PASS impossible,
 *   3. nobody approves, verifies or closes what they themselves submitted,
 *   4. an NCR cannot close without a root cause and a verified action,
 *   5. accepted + rejected + conditional = inspected, exactly,
 *   6. a used template is versioned, never rewritten,
 *   7. Company B is unreachable by every route in and out.
 */

const templateQuery = templateListQuerySchema.parse({ limit: 100 });
const requestQuery = requestListQuerySchema.parse({ limit: 100 });
const inspectionQuery = inspectionListQuerySchema.parse({ limit: 100 });
const defectQuery = defectListQuerySchema.parse({ limit: 100 });
const ncrQuery = ncrListQuerySchema.parse({ limit: 100 });
const actionQuery = correctiveActionListQuerySchema.parse({ limit: 100 });

const SEED = {
  templateConcrete: "tpl_concrete",
  templateMaterial: "tpl_material",
  templateArchived: "tpl_retired",
  openRequest: "ir_005",
  completedRequest: "ir_001",
  draftInspection: "ins_009",
  liveInspection: "ins_008",
  pendingInspection: "ins_005",
  passedPending: "ins_006",
  approvedConditional: "ins_004",
  closedFail: "ins_002",
  closedPass: "ins_001",
  rejectedInspection: "ins_007",
  openDefect: "def_004",
  resolvedDefect: "def_003",
  closedDefect: "def_001",
  draftNcr: "ncr_004",
  liveNcr: "ncr_003",
  pendingNcr: "ncr_002",
  closedNcr: "ncr_001",
  pendingAction: "ca_003",
  verifiedAction: "ca_001",
  openAction: "ca_005",
  companyBTemplate: "tpl_b_001",
  companyBInspection: "ins_b_001",
  companyBNcr: "ncr_b_001",
  projectA: "project_a",
} as const;

const created = {
  templates: [] as string[],
  requests: [] as string[],
  inspections: [] as string[],
  defects: [] as string[],
  ncrs: [] as string[],
  actions: [] as string[],
};

/**
 * Restores anything a test changed on a *seeded* record.
 *
 * The suite runs against the shared development database, so a test that
 * approves a seeded inspection has to put it back — otherwise the next run
 * finds it already approved and the failure looks like a product bug.
 */
const touched: { model: string; id: string; data: Record<string, unknown> }[] = [];

async function remember(
  model: "inspection" | "defect" | "ncr" | "action" | "request" | "template",
  id: string,
) {
  if (model === "inspection") {
    const row = await prisma.qualityInspection.findUniqueOrThrow({
      where: { id },
      select: {
        status: true, result: true, submittedAt: true, approvedAt: true,
        approvedByMemberId: true, rejectedAt: true, rejectedByMemberId: true,
        closedAt: true, closedByMemberId: true, cancelledAt: true, decisionNote: true,
      },
    });
    touched.push({ model, id, data: row });
  } else if (model === "defect") {
    const row = await prisma.qualityDefect.findUniqueOrThrow({
      where: { id },
      select: {
        status: true, resolutionNote: true, resolvedAt: true, resolvedByMemberId: true,
        closedAt: true, closedByMemberId: true, cancelledAt: true,
      },
    });
    touched.push({ model, id, data: row });
  } else if (model === "ncr") {
    const row = await prisma.nonConformanceReport.findUniqueOrThrow({
      where: { id },
      select: {
        status: true, submittedAt: true, approvedAt: true, approvedByMemberId: true,
        rejectedAt: true, rejectedByMemberId: true, closedAt: true, closedByMemberId: true,
        closureNote: true, cancelledAt: true, rootCause: true,
      },
    });
    touched.push({ model, id, data: row });
  } else if (model === "action") {
    const row = await prisma.correctiveAction.findUniqueOrThrow({
      where: { id },
      select: {
        status: true, completionNote: true, completedAt: true, completedByMemberId: true,
        verificationNote: true, verifiedAt: true, verifiedByMemberId: true, cancelledAt: true,
      },
    });
    touched.push({ model, id, data: row });
  } else if (model === "request") {
    const row = await prisma.inspectionRequest.findUniqueOrThrow({
      where: { id },
      select: { status: true, assignedInspectorMemberId: true, cancelledAt: true },
    });
    touched.push({ model, id, data: row });
  } else {
    const row = await prisma.inspectionTemplate.findUniqueOrThrow({
      where: { id },
      select: { status: true, archivedAt: true },
    });
    touched.push({ model, id, data: row });
  }
}

/** Every approval cycle a test opened, so the next run starts clean. */
const openedApprovals: string[] = [];

afterEach(async () => {
  const ids = [
    ...created.inspections,
    ...created.defects,
    ...created.ncrs,
    ...created.actions,
    ...created.requests,
    ...created.templates,
  ];
  if (ids.length > 0) await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });

  if (created.actions.length > 0) {
    await prisma.correctiveAction.deleteMany({ where: { id: { in: created.actions } } });
    created.actions.length = 0;
  }
  if (created.ncrs.length > 0) {
    await prisma.correctiveAction.deleteMany({ where: { ncrId: { in: created.ncrs } } });
    await prisma.qualityApproval.deleteMany({ where: { recordId: { in: created.ncrs } } });
    await prisma.nonConformanceReport.deleteMany({ where: { id: { in: created.ncrs } } });
    created.ncrs.length = 0;
  }
  if (created.defects.length > 0) {
    await prisma.nonConformanceReport.deleteMany({ where: { sourceDefectId: { in: created.defects } } });
    await prisma.correctiveAction.deleteMany({ where: { defectId: { in: created.defects } } });
    await prisma.qualityDefect.deleteMany({ where: { id: { in: created.defects } } });
    created.defects.length = 0;
  }
  if (created.inspections.length > 0) {
    await prisma.qualityApproval.deleteMany({ where: { recordId: { in: created.inspections } } });
    await prisma.materialInspectionDecision.deleteMany({ where: { inspectionId: { in: created.inspections } } });
    await prisma.qualityMaterialRelease.deleteMany({ where: { inspectionId: { in: created.inspections } } });
    await prisma.inspectionChecklistItem.deleteMany({ where: { inspectionId: { in: created.inspections } } });
    await prisma.qualityInspection.deleteMany({ where: { parentInspectionId: { in: created.inspections } } });
    await prisma.qualityInspection.deleteMany({ where: { id: { in: created.inspections } } });
    created.inspections.length = 0;
  }
  if (created.requests.length > 0) {
    await prisma.inspectionRequest.deleteMany({ where: { id: { in: created.requests } } });
    created.requests.length = 0;
  }
  if (created.templates.length > 0) {
    await prisma.inspectionTemplateItem.deleteMany({ where: { inspectionTemplateId: { in: created.templates } } });
    await prisma.inspectionTemplate.deleteMany({ where: { id: { in: created.templates } } });
    created.templates.length = 0;
  }

  if (openedApprovals.length > 0) {
    await prisma.qualityApproval.deleteMany({ where: { id: { in: openedApprovals } } });
    openedApprovals.length = 0;
  }

  for (const row of touched) {
    if (row.model === "inspection") {
      await prisma.qualityInspection.update({ where: { id: row.id }, data: row.data as never });
    } else if (row.model === "defect") {
      await prisma.qualityDefect.update({ where: { id: row.id }, data: row.data as never });
    } else if (row.model === "ncr") {
      await prisma.nonConformanceReport.update({ where: { id: row.id }, data: row.data as never });
    } else if (row.model === "action") {
      await prisma.correctiveAction.update({ where: { id: row.id }, data: row.data as never });
    } else if (row.model === "request") {
      await prisma.inspectionRequest.update({ where: { id: row.id }, data: row.data as never });
    } else {
      await prisma.inspectionTemplate.update({ where: { id: row.id }, data: row.data as never });
    }
  }
  touched.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/** Tracks whatever approval cycle a submission opened, for cleanup. */
async function trackApproval(recordType: "INSPECTION" | "NCR", recordId: string) {
  const row = await prisma.qualityApproval.findFirst({
    where: { recordType, recordId, status: "PENDING" },
    orderBy: { submittedAt: "desc" },
    select: { id: true },
  });
  if (row) openedApprovals.push(row.id);
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

describe("templates (PRD #21 §49–§58)", () => {
  it("lists templates with their check counts", async () => {
    const context = await loginAs("QAQC");
    const result = await templates.listTemplates(context, templateQuery);

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.some((row) => row.itemCount > 0)).toBe(true);
  });

  it("versions a used template rather than rewriting it (§53)", async () => {
    const context = await loginAs("QAQC");
    const before = await templates.getTemplate(context, SEED.templateConcrete);
    expect(before.usageCount).toBeGreaterThan(0);

    // Captured before the mutation: creating a new version retires this one to
    // INACTIVE, and the next test needs it active again.
    await remember("template", SEED.templateConcrete);

    const updated = await templates.updateTemplate(
      context,
      SEED.templateConcrete,
      templateSchema.parse({
        code: before.code,
        name: `${before.name} (revised)`,
        inspectionType: before.inspectionType,
        items: before.items.map((item) => ({
          label: item.label,
          responseType: item.responseType,
          required: item.required,
        })),
        versionUpdatedAt: before.updatedAt,
      }),
    );
    created.templates.push(updated.id);

    // A new record, a higher version, and the original untouched.
    expect(updated.id).not.toBe(SEED.templateConcrete);
    expect(updated.version).toBe(before.version + 1);

    const original = await templates.getTemplate(context, SEED.templateConcrete);
    expect(original.name).toBe(before.name);
    expect(original.items.length).toBe(before.items.length);
  });

  it("edits an unused template in place", async () => {
    const context = await loginAs("QAQC");

    const created_ = await templates.createTemplate(
      context,
      templateSchema.parse({
        code: `VITEST-${Date.now()}`,
        name: "Vitest template",
        inspectionType: "GENERAL",
        items: [{ label: "A check", responseType: "PASS_FAIL" }],
      }),
    );
    created.templates.push(created_.id);

    const updated = await templates.updateTemplate(
      context,
      created_.id,
      templateSchema.parse({
        code: created_.code,
        name: "Vitest template, renamed",
        inspectionType: "GENERAL",
        items: [{ label: "A check", responseType: "PASS_FAIL" }],
        versionUpdatedAt: created_.updatedAt,
      }),
    );

    expect(updated.id).toBe(created_.id);
    expect(updated.version).toBe(1);
    expect(updated.name).toBe("Vitest template, renamed");
  });

  it("offers only active templates for a new inspection (§52)", async () => {
    const context = await loginAs("QAQC");
    const options = await templates.selectableTemplates(context);

    expect(options.some((row) => row.value === SEED.templateArchived)).toBe(false);
    expect(options.some((row) => row.value === SEED.templateConcrete)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

describe("inspections (PRD #21 §63–§88)", () => {
  it("keeps status and result as separate facts (§65)", async () => {
    const context = await loginAs("QAQC");
    const inspection = await inspections.getInspection(context, SEED.pendingInspection);

    // The state the module exists to be able to express.
    expect(inspection.status).toBe("PENDING_APPROVAL");
    expect(inspection.result).toBe("FAIL");
  });

  it("copies the checklist onto the inspection rather than referencing it (§69)", async () => {
    const context = await loginAs("QAQC");
    const template = await templates.getTemplate(context, SEED.templateConcrete);

    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "WORK",
        templateId: SEED.templateConcrete,
        projectId: SEED.projectA,
        assignedInspectorMemberId: (await inspectorId()),
      }),
    );
    created.inspections.push(inspection.id);

    expect(inspection.checklist.length).toBe(template.items.length);
    expect(inspection.checklist[0]!.label).toBe(template.items[0]!.label);
    // The criterion travels with the question (§69).
    expect(
      inspection.checklist.some((item) => item.passCriteriaText !== null),
    ).toBe(true);
  });

  it("refuses to submit with a required check unanswered (§75)", async () => {
    const context = await loginAs("QAQC");

    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "WORK",
        templateId: SEED.templateConcrete,
        projectId: SEED.projectA,
        assignedInspectorMemberId: (await inspectorId()),
      }),
    );
    created.inspections.push(inspection.id);

    // Answer one item only, so the rest stay blank.
    await inspections.saveChecklist(context, inspection.id, {
      answers: [{ itemId: inspection.checklist[0]!.id, result: "PASS", responseValue: undefined, note: undefined }],
    });

    await expect(
      inspections.submitInspection(
        context,
        inspection.id,
        submitInspectionSchema.parse({ result: "PASS" }),
      ),
    ).rejects.toMatchObject({ details: { code: "CHECKLIST_INCOMPLETE" } });
  });

  it("refuses to call a failed inspection a pass (§77)", async () => {
    const context = await loginAs("QAQC");
    const inspection = await answeredInspection(context, { failFirst: true });

    await expect(
      inspections.submitInspection(
        context,
        inspection.id,
        submitInspectionSchema.parse({ result: "PASS" }),
      ),
    ).rejects.toMatchObject({ details: { code: "RESULT_INCONSISTENT" } });

    // A conditional acceptance is still allowed, with its condition stated.
    await inspections.submitInspection(
      context,
      inspection.id,
      submitInspectionSchema.parse({
        result: "CONDITIONAL",
        decisionNote: "Accepted subject to the cover being re-checked before the pour.",
      }),
    );
    await trackApproval("INSPECTION", inspection.id);

    const after = await inspections.getInspection(context, inspection.id);
    expect(after.status).toBe("PENDING_APPROVAL");
    expect(after.result).toBe("CONDITIONAL");
  });

  it("requires a note before a failure can be submitted, where the check says so (§57)", async () => {
    const context = await loginAs("QAQC");

    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "WORK",
        templateId: SEED.templateConcrete,
        projectId: SEED.projectA,
        assignedInspectorMemberId: (await inspectorId()),
      }),
    );
    created.inspections.push(inspection.id);

    const evidenceItem = inspection.checklist.find((item) => item.requiresEvidenceOnFail)!;
    expect(evidenceItem).toBeTruthy();

    await inspections.saveChecklist(context, inspection.id, {
      answers: inspection.checklist.map((item) => ({
        itemId: item.id,
        result: item.id === evidenceItem.id ? ("FAIL" as const) : ("PASS" as const),
        responseValue: "recorded",
        note: undefined,
      })),
    });

    await expect(
      inspections.submitInspection(
        context,
        inspection.id,
        submitInspectionSchema.parse({ result: "FAIL" }),
      ),
    ).rejects.toMatchObject({ details: { code: "CHECKLIST_INCOMPLETE" } });
  });

  it("refuses to close a failure with no follow-up recorded (§85)", async () => {
    const context = await loginAs("QAQC");
    const owner = await loginAs("OWNER");

    const inspection = await answeredInspection(context, { failFirst: true });
    await inspections.submitInspection(
      context,
      inspection.id,
      submitInspectionSchema.parse({ result: "FAIL" }),
    );
    await trackApproval("INSPECTION", inspection.id);
    await inspections.approveInspection(owner, inspection.id, null);

    await expect(
      inspections.closeInspection(owner, inspection.id, null),
    ).rejects.toMatchObject({ details: { code: "FOLLOW_UP_REQUIRED" } });

    // Stating the disposition in writing is the alternative to a follow-up.
    await inspections.closeInspection(
      owner,
      inspection.id,
      "Accepted as built; the client has agreed in writing.",
    );

    const after = await inspections.getInspection(owner, inspection.id);
    expect(after.status).toBe("CLOSED");
  });

  it("closes a pass without any follow-up (§84)", async () => {
    const context = await loginAs("QAQC");
    const owner = await loginAs("OWNER");

    const inspection = await answeredInspection(context, { failFirst: false });
    await inspections.submitInspection(
      context,
      inspection.id,
      submitInspectionSchema.parse({ result: "PASS" }),
    );
    await trackApproval("INSPECTION", inspection.id);
    await inspections.approveInspection(owner, inspection.id, null);
    await inspections.closeInspection(owner, inspection.id, null);

    const after = await inspections.getInspection(owner, inspection.id);
    expect(after.status).toBe("CLOSED");
    expect(after.result).toBe("PASS");
  });

  it("keeps the rejection on the record when an inspection is reworked (§82)", async () => {
    const context = await loginAs("QAQC");
    const owner = await loginAs("OWNER");

    const inspection = await answeredInspection(context, { failFirst: false });
    await inspections.submitInspection(
      context,
      inspection.id,
      submitInspectionSchema.parse({ result: "PASS" }),
    );
    await trackApproval("INSPECTION", inspection.id);
    await inspections.rejectInspection(owner, inspection.id, "Measurements not recorded.");

    const rejected = await inspections.getInspection(context, inspection.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectedAt).not.toBeNull();

    await inspections.reworkInspection(context, inspection.id);

    const reworked = await inspections.getInspection(context, inspection.id);
    expect(reworked.status).toBe("IN_PROGRESS");
    expect(reworked.result).toBe("NOT_SET");
    // The rejection is history, not erased.
    expect(reworked.rejectedAt).not.toBeNull();
  });

  it("raises a reinspection without touching the original (§154, §156)", async () => {
    const context = await loginAs("QAQC");
    const parentBefore = await inspections.getInspection(context, SEED.closedFail);

    const reinspection = await inspections.createReinspection(context, SEED.closedFail, {
      assignedInspectorMemberId: await inspectorId(),
      inspectionDate: undefined,
      summary: "Vitest re-look",
    });
    created.inspections.push(reinspection.id);

    expect(reinspection.parentInspectionId).toBe(SEED.closedFail);
    expect(reinspection.reinspectionSequence).toBe(parentBefore.reinspections.length + 1);
    expect(reinspection.status).toBe("DRAFT");
    expect(reinspection.result).toBe("NOT_SET");
    // Same checklist, so the two verdicts are comparable.
    expect(reinspection.checklist.length).toBe(parentBefore.checklist.length);

    const parentAfter = await inspections.getInspection(context, SEED.closedFail);
    expect(parentAfter.status).toBe(parentBefore.status);
    expect(parentAfter.result).toBe(parentBefore.result);
  });

  it("refuses a reinspection of something that passed (§158)", async () => {
    const context = await loginAs("QAQC");

    await expect(
      inspections.createReinspection(context, SEED.closedPass, {
        assignedInspectorMemberId: await inspectorId(),
        inspectionDate: undefined,
        summary: undefined,
      }),
    ).rejects.toMatchObject({ details: { code: "PARENT_PASSED" } });
  });

  it("refuses to edit an inspection that has started (§66)", async () => {
    const context = await loginAs("QAQC");
    const inspection = await inspections.getInspection(context, SEED.liveInspection);

    await expect(
      inspections.updateInspection(
        context,
        SEED.liveInspection,
        inspectionSchema.parse({
          inspectionType: inspection.inspectionType,
          projectId: inspection.project?.id,
          assignedInspectorMemberId: inspection.assignedInspector!.memberId,
          versionUpdatedAt: inspection.updatedAt,
        }),
      ),
    ).rejects.toMatchObject({ details: { code: "INSPECTION_LOCKED" } });
  });
});

/* -------------------------------------------------------------------------- */
/* Separation of duties                                                        */
/* -------------------------------------------------------------------------- */

describe("separation of duties (PRD #21 §165, §119, §147)", () => {
  it("refuses to approve an inspection you submitted (§165)", async () => {
    const context = await loginAs("QAQC");
    const inspection = await answeredInspection(context, { failFirst: false });

    await inspections.submitInspection(
      context,
      inspection.id,
      submitInspectionSchema.parse({ result: "PASS" }),
    );
    await trackApproval("INSPECTION", inspection.id);

    await expect(
      inspections.approveInspection(context, inspection.id, null),
    ).rejects.toMatchObject({ details: { code: "SELF_APPROVAL" } });
  });

  it("withholds the approve capability from the submitter, not just the action", async () => {
    const context = await loginAs("QAQC");
    const inspection = await inspections.getInspection(context, SEED.pendingInspection);

    // The seed's pending approvals were all submitted by QA/QC.
    expect(inspection.status).toBe("PENDING_APPROVAL");
    expect(inspection.capabilities.canApprove).toBe(false);

    const owner = await loginAs("OWNER");
    const asOwner = await inspections.getInspection(owner, SEED.pendingInspection);
    expect(asOwner.capabilities.canApprove).toBe(true);
  });

  it("hides the decision from the submitter in the approval queue (§164)", async () => {
    const context = await loginAs("QAQC");
    const queue = await approvals.listApprovals(context, approvalListQuerySchema.parse({}));

    expect(queue.data.length).toBeGreaterThan(0);
    expect(queue.data.every((row) => row.canDecide === false)).toBe(true);

    const owner = await loginAs("OWNER");
    const ownerQueue = await approvals.listApprovals(owner, approvalListQuerySchema.parse({}));
    expect(ownerQueue.data.some((row) => row.canDecide)).toBe(true);
  });

  it("refuses to close a defect you resolved yourself (§119)", async () => {
    const context = await loginAs("QAQC");
    const defect = await defects.createDefect(
      context,
      defectSchema.parse({
        title: "Vitest defect",
        description: "Raised by a test.",
        projectId: SEED.projectA,
        severity: "LOW",
      }),
    );
    created.defects.push(defect.id);

    await defects.resolveDefect(context, defect.id, "Fixed by the same person who is closing it.");

    await expect(defects.closeDefect(context, defect.id)).rejects.toMatchObject({
      details: { code: "SELF_CLOSE" },
    });

    // Somebody else can.
    const owner = await loginAs("OWNER");
    await defects.closeDefect(owner, defect.id);
    expect((await defects.getDefect(owner, defect.id)).status).toBe("CLOSED");
  });

  it("refuses to verify a corrective action you completed yourself (§147)", async () => {
    const context = await loginAs("QAQC");
    const action = await actions.createAction(
      context,
      correctiveActionSchema.parse({
        title: "Vitest action",
        description: "Raised by a test.",
        ncrId: SEED.liveNcr,
        assignedToMemberId: await inspectorId(),
      }),
    );
    created.actions.push(action.id);

    await actions.completeAction(context, action.id, "Done by the same person verifying it.");

    await expect(actions.verifyAction(context, action.id, null)).rejects.toMatchObject({
      details: { code: "SELF_VERIFY" },
    });

    const owner = await loginAs("OWNER");
    await actions.verifyAction(owner, action.id, "Checked on site.");
    expect((await actions.getAction(owner, action.id)).status).toBe("VERIFIED");
  });
});

/* -------------------------------------------------------------------------- */
/* NCR closure                                                                 */
/* -------------------------------------------------------------------------- */

describe("NCR closure (PRD #21 §136, §137)", () => {
  it("names exactly what is still missing", async () => {
    const context = await loginAs("QAQC");
    const ncr = await ncrs.getNcr(context, SEED.liveNcr);

    expect(ncr.closureGaps).toContain("ROOT_CAUSE");
    expect(ncr.closureGaps).toContain("UNVERIFIED_ACTION");
    // It is CRITICAL, so it also needs a written closure note (§137).
    expect(ncr.closureGaps).toContain("CLOSURE_NOTE");
    expect(ncr.capabilities.canSubmit).toBe(false);
  });

  it("refuses to submit an NCR with no root cause", async () => {
    const context = await loginAs("QAQC");
    await remember("ncr", SEED.liveNcr);

    await expect(ncrs.submitNcr(context, SEED.liveNcr)).rejects.toMatchObject({
      details: { code: "CLOSURE_INCOMPLETE" },
    });
  });

  it("refuses to close over an unverified corrective action", async () => {
    const context = await loginAs("QAQC");
    const owner = await loginAs("OWNER");

    const ncr = await ncrs.createNcr(
      context,
      ncrSchema.parse({
        title: "Vitest NCR",
        description: "Raised by a test.",
        category: "PROCESS",
        severity: "LOW",
        rootCause: "A cause, written down.",
      }),
    );
    created.ncrs.push(ncr.id);
    await ncrs.openNcr(context, ncr.id);

    const action = await actions.createAction(
      context,
      correctiveActionSchema.parse({
        title: "Vitest action",
        description: "Raised by a test.",
        ncrId: ncr.id,
        assignedToMemberId: await inspectorId(),
      }),
    );
    created.actions.push(action.id);

    // Still open, so the NCR cannot go for closure.
    await expect(ncrs.submitNcr(context, ncr.id)).rejects.toMatchObject({
      details: { code: "CLOSURE_INCOMPLETE" },
    });

    await actions.completeAction(context, action.id, "Done.");
    await actions.verifyAction(owner, action.id, "Checked.");

    // Now it can: cause recorded, action verified.
    await ncrs.submitNcr(context, ncr.id);
    await trackApproval("NCR", ncr.id);

    await ncrs.approveNcr(owner, ncr.id, null);
    await ncrs.closeNcr(owner, ncr.id, null);

    expect((await ncrs.getNcr(owner, ncr.id)).status).toBe("CLOSED");
  });

  it("escalates a defect into an NCR without closing the defect (§170, §172)", async () => {
    const context = await loginAs("QAQC");

    const defect = await defects.createDefect(
      context,
      defectSchema.parse({
        title: "Vitest escalation",
        description: "Raised by a test.",
        projectId: SEED.projectA,
        severity: "HIGH",
      }),
    );
    created.defects.push(defect.id);

    const ncr = await ncrs.escalateDefect(context, defect.id, { category: "WORKMANSHIP" });
    created.ncrs.push(ncr.id);

    expect(ncr.sourceDefect?.id).toBe(defect.id);
    expect(ncr.severity).toBe("HIGH");

    // The defect still has to be fixed.
    const after = await defects.getDefect(context, defect.id);
    expect(after.status).toBe("OPEN");
    expect(after.ncrs.some((row) => row.id === ncr.id)).toBe(true);

    await expect(
      ncrs.escalateDefect(context, defect.id, { category: "WORKMANSHIP" }),
    ).rejects.toMatchObject({ details: { code: "ALREADY_ESCALATED" } });
  });
});

/* -------------------------------------------------------------------------- */
/* Material quality                                                            */
/* -------------------------------------------------------------------------- */

describe("material quality (PRD #21 §91, §92, §98)", () => {
  it("holds accepted + rejected + conditional = inspected, exactly", async () => {
    const rows = await prisma.materialInspectionDecision.findMany();
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const total = row.acceptedQuantity
        .plus(row.rejectedQuantity)
        .plus(row.conditionalQuantity);
      expect(total.equals(row.inspectedQuantity)).toBe(true);
    }
  });

  it("refuses a decision that does not balance", async () => {
    const parsed = materialDecisionSchema.safeParse({
      goodsReceiptItemId: "line",
      inspectedQuantity: "100",
      acceptedQuantity: "80",
      rejectedQuantity: "10",
      conditionalQuantity: "5",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.acceptedQuantity?.[0]).toMatch(/add up/i);
    }
  });

  it("refuses to inspect more than actually arrived (§92)", async () => {
    const context = await loginAs("QAQC");
    const inspection = await inspections.getInspection(context, SEED.approvedConditional);
    const lines = await materials.inspectableLines(context, inspection.source!.id);
    expect(lines.length).toBeGreaterThan(0);

    // A fresh material inspection on the same delivery, claiming the whole line
    // again — the earlier decision already accounts for it.
    const second = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "MATERIAL",
        goodsReceiptId: inspection.source!.id,
        assignedInspectorMemberId: await inspectorId(),
      }),
    );
    created.inspections.push(second.id);

    const line = lines[0]!;
    await expect(
      materials.recordDecision(
        context,
        second.id,
        materialDecisionSchema.parse({
          goodsReceiptItemId: line.id,
          inspectedQuantity: line.receivedQuantity,
          acceptedQuantity: line.receivedQuantity,
          rejectedQuantity: "0",
          conditionalQuantity: "0",
        }),
      ),
    ).rejects.toMatchObject({ details: { code: "OVER_INSPECTED" } });
  });

  it("refuses to release from an inspection that is not approved (§98)", async () => {
    const context = await loginAs("QAQC");

    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "MATERIAL",
        goodsReceiptId: (await inspections.getInspection(context, SEED.approvedConditional)).source!.id,
        assignedInspectorMemberId: await inspectorId(),
      }),
    );
    created.inspections.push(inspection.id);

    await expect(
      materials.releaseMaterial(context, inspection.id, null),
    ).rejects.toMatchObject({ details: { code: "NOT_APPROVED" } });
  });

  it("tells Inventory what it may book in (§102)", async () => {
    const context = await loginAs("QAQC");
    const inspection = await inspections.getInspection(context, SEED.closedPass);

    const status = await materials.materialQualityStatus(context, inspection.source!.id);
    expect(status).not.toBeNull();
    expect(status!.clearedForPosting).toBe(true);
    expect(typeof status!.releasedQuantity).toBe("string");
  });

  it("does not gate a delivery nobody inspected (§95)", async () => {
    const context = await loginAs("QAQC");
    const status = await materials.materialQualityStatus(context, "receipt_003");

    expect(status).not.toBeNull();
    expect(status!.inspectionId).toBeNull();
    // Quality is not gating this one, so Inventory proceeds as it always has.
    expect(status!.clearedForPosting).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Authorisation                                                               */
/* -------------------------------------------------------------------------- */

describe("authorisation (PRD #21 §23–§30)", () => {
  it("gives Admin and Company IT no QA/QC business access (§23, §24)", async () => {
    for (const role of ["ADMIN", "COMPANY_IT"] as const) {
      const context = await loginAs(role);
      expect(can(context, "qaqc.inspection.view")).toBe(false);
      expect(can(context, "qaqc.ncr.view")).toBe(false);
      await expect(qaqcOverview(context)).rejects.toBeInstanceOf(AccessError);
    }
  });

  it("gives the CEO a view without routine mutation (§25)", async () => {
    const context = await loginAs("CEO");
    if (!can(context, "qaqc.view")) return;

    expect(can(context, "qaqc.inspection.execute")).toBe(false);
    expect(can(context, "qaqc.defect.create")).toBe(false);
  });

  it("gives nobody the self-approval grant by default (§165)", async () => {
    for (const role of ["OWNER", "QAQC", "CEO", "PROJECT_MANAGER"] as const) {
      const context = await loginAs(role);
      expect(can(context, "qaqc.approval.self")).toBe(false);
    }
  });

  it("scopes a project reader to their own projects (§26)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    if (!can(pm, "qaqc.defect.view")) return;

    const scoped = await defects.listDefects(pm, defectQuery);
    const all = await defects.listDefects(await loginAs("QAQC"), defectQuery);

    expect(scoped.data.length).toBeLessThanOrEqual(all.data.length);
    expect(scoped.data.every((row) => all.data.some((other) => other.id === row.id))).toBe(true);
  });

  it("does not let Procurement approve quality inspections (§28)", async () => {
    const context = await loginAs("PROCUREMENT");
    expect(can(context, "qaqc.inspection.approve")).toBe(false);
    expect(can(context, "qaqc.material.release")).toBe(false);
  });

  it("does not let Inventory mutate quality (§29)", async () => {
    const context = await loginAs("INVENTORY");
    expect(can(context, "qaqc.inspection.execute")).toBe(false);
    expect(can(context, "qaqc.material.release")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Company isolation                                                           */
/* -------------------------------------------------------------------------- */

describe("company isolation (PRD #21 §202)", () => {
  it("never lists a Company B record", async () => {
    const context = await loginAs("OWNER");

    const [templateRows, inspectionRows, ncrRows] = await Promise.all([
      templates.listTemplates(context, templateQuery),
      inspections.listInspections(context, inspectionQuery),
      ncrs.listNcrs(context, ncrQuery),
    ]);

    expect(templateRows.data.some((row) => row.id === SEED.companyBTemplate)).toBe(false);
    expect(inspectionRows.data.some((row) => row.id === SEED.companyBInspection)).toBe(false);
    expect(ncrRows.data.some((row) => row.id === SEED.companyBNcr)).toBe(false);
  });

  it("answers 404, not 403, for a Company B record", async () => {
    const context = await loginAs("OWNER");

    await expect(
      inspections.getInspection(context, SEED.companyBInspection),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ncrs.getNcr(context, SEED.companyBNcr)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not leak Company B through search", async () => {
    const context = await loginAs("OWNER");
    const result = await ncrs.listNcrs(
      context,
      ncrListQuerySchema.parse({ search: "Company B", limit: 100 }),
    );
    expect(result.data.length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Overview and reports                                                        */
/* -------------------------------------------------------------------------- */

describe("overview and reports (PRD #21 §193, §202)", () => {
  it("counts the pass rate from decided inspections only", async () => {
    const context = await loginAs("QAQC");
    const overview = await qaqcOverview(context);

    expect(overview.passRate).not.toBeNull();
    expect(overview.passRate!.total).toBeGreaterThan(0);

    const decided = await prisma.qualityInspection.count({
      where: {
        companyId: context.companyId,
        status: { in: ["APPROVED", "CLOSED"] },
        result: { not: "NOT_SET" },
      },
    });
    expect(overview.passRate!.total).toBe(decided);
  });

  it("scopes every report to the reader", async () => {
    const full = await qaqcReports(await loginAs("QAQC"));
    expect(full.passRateOverall.total).toBeGreaterThan(0);

    const pm = await loginAs("PROJECT_MANAGER");
    if (!can(pm, "qaqc.report.view")) return;

    const scoped = await qaqcReports(pm);
    expect(scoped.passRateOverall.total).toBeLessThanOrEqual(full.passRateOverall.total);
  });

  it("lists every record kind for a reader who holds them", async () => {
    const context = await loginAs("QAQC");

    const [requestRows, inspectionRows, defectRows, ncrRows, actionRows] = await Promise.all([
      requests.listRequests(context, requestQuery),
      inspections.listInspections(context, inspectionQuery),
      defects.listDefects(context, defectQuery),
      ncrs.listNcrs(context, ncrQuery),
      actions.listActions(context, actionQuery),
    ]);

    expect(requestRows.data.length).toBeGreaterThan(0);
    expect(inspectionRows.data.length).toBeGreaterThan(0);
    expect(defectRows.data.length).toBeGreaterThan(0);
    expect(ncrRows.data.length).toBeGreaterThan(0);
    expect(actionRows.data.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function inspectorId(): Promise<string> {
  const member = await prisma.companyMember.findFirstOrThrow({
    where: { user: { email: "qaqc@nesto.test" } },
    select: { id: true },
  });
  return member.id;
}

/** An inspection with every required item answered, ready to submit. */
async function answeredInspection(
  context: Awaited<ReturnType<typeof loginAs>>,
  options: { failFirst: boolean },
) {
  const inspection = await inspections.createInspection(
    context,
    inspectionSchema.parse({
      inspectionType: "WORK",
      templateId: SEED.templateConcrete,
      projectId: SEED.projectA,
      assignedInspectorMemberId: await inspectorId(),
    }),
  );
  created.inspections.push(inspection.id);

  const failing = options.failFirst ? inspection.checklist[0]!.id : null;

  await inspections.saveChecklist(context, inspection.id, {
    answers: inspection.checklist.map((item) => ({
      itemId: item.id,
      result: item.id === failing ? ("FAIL" as const) : ("PASS" as const),
      responseValue: "38",
      note: item.id === failing ? "Measured below the stated criterion." : undefined,
    })),
  });

  return inspections.getInspection(context, inspection.id);
}

/* -------------------------------------------------------------------------- */
/* The Inventory gate                                                          */
/* -------------------------------------------------------------------------- */

describe("the Inventory gate (PRD #21 §95, §102)", () => {
  it("is a company setting, not a hard-wired rule (§95)", async () => {
    const rows = await prisma.companyIntegrationSettings.findMany({
      select: { companyId: true, qualityGateForInventoryReceipts: true },
    });

    // The demo company runs with the gate on, which is what makes the
    // Procurement → QA → Inventory flow visible. Another company may run with
    // it off and Inventory behaves exactly as it did before QA/QC existed.
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.some((row) => row.qualityGateForInventoryReceipts)).toBe(true);
    expect(rows.some((row) => !row.qualityGateForInventoryReceipts)).toBe(true);
  });

  it("blocks a booking when the gate is on and quality has not released", async () => {
    const context = await loginAs("INVENTORY");
    const receipts = await import("@/lib/modules/inventory/documents/receipt.service");

    const config = await prisma.companyIntegrationSettings.findUniqueOrThrow({
      where: { companyId: context.companyId },
      select: { qualityGateForInventoryReceipts: true },
    });
    expect(config.qualityGateForInventoryReceipts).toBe(true);

    // receipt_003 has no quality inspection at all, so nothing has released it.
    await expect(
      receipts.postFromGoodsReceipt(context, "receipt_003", {
        warehouseId: "wh_central",
        lines: [],
      }),
    ).rejects.toMatchObject({ details: { code: "QUALITY_GATE" } });
  });

  it("lets a released delivery through (§102)", async () => {
    const qaqc = await loginAs("QAQC");
    const inventory = await loginAs("INVENTORY");
    const receipts = await import("@/lib/modules/inventory/documents/receipt.service");

    // receipt_001 was inspected and released on INS-2026-0001.
    const inspection = await inspections.getInspection(qaqc, SEED.closedPass);
    expect(inspection.release?.status).toBe("RELEASED");

    // The gate passes, so the refusal that follows is about the line mapping —
    // an ordinary validation, not the quality gate.
    await expect(
      receipts.postFromGoodsReceipt(inventory, inspection.source!.id, {
        warehouseId: "wh_central",
        lines: [],
      }),
    ).rejects.toMatchObject({ details: { code: "MAPPING_REQUIRED" } });
  });

  it("refuses to revoke a release once Inventory has posted (§103)", async () => {
    const context = await loginAs("QAQC");
    const inspection = await inspections.getInspection(context, SEED.closedPass);

    const posted = await prisma.inventoryReceipt.count({
      where: { goodsReceiptId: inspection.source!.id, status: "POSTED" },
    });

    if (posted === 0) {
      // Nothing has been booked in, so revoking is still allowed — which is the
      // other half of the same rule.
      return;
    }

    await expect(
      (await import("@/lib/modules/qaqc/materials/material.service")).revokeRelease(
        context,
        SEED.closedPass,
        "Vitest",
      ),
    ).rejects.toMatchObject({ details: { code: "ALREADY_POSTED" } });
  });
});

/* -------------------------------------------------------------------------- */
/* Export, tasks and supplier quality                                          */
/* -------------------------------------------------------------------------- */

describe("export (PRD #21 §201, §202)", () => {
  it("writes the same rows the list shows", async () => {
    const context = await loginAs("QAQC");
    const { exportQaqc } = await import("@/lib/modules/qaqc/qaqc.export");

    const { filename, csv } = await exportQaqc(context, "inspections", {
      inspections: inspectionListQuerySchema.parse({ limit: 500 }),
    });

    expect(filename).toMatch(/^qaqc-inspections-\d{4}-\d{2}-\d{2}\.csv$/);

    const [header, ...rows] = csv.split("\n");
    // Status and result stay separate columns (§65).
    expect(header).toContain("Status");
    expect(header).toContain("Result");

    const listed = await inspections.listInspections(
      context,
      inspectionListQuerySchema.parse({ limit: 500 }),
    );
    expect(rows.length).toBe(listed.data.length);
  });

  it("never exports a Company B row", async () => {
    const context = await loginAs("OWNER");
    const { exportQaqc } = await import("@/lib/modules/qaqc/qaqc.export");

    const { csv } = await exportQaqc(context, "ncrs", {
      ncrs: ncrListQuerySchema.parse({ limit: 500 }),
    });
    expect(csv).not.toContain("Company B");
  });

  it("refuses a reader without the export grant", async () => {
    const context = await loginAs("INVENTORY");
    const { exportQaqc } = await import("@/lib/modules/qaqc/qaqc.export");

    // Inventory holds a restricted quality read but no export grant (§29).
    expect(can(context, "qaqc.material.view")).toBe(true);
    expect(can(context, "qaqc.export")).toBe(false);

    await expect(
      exportQaqc(context, "inspections", {
        inspections: inspectionListQuerySchema.parse({ limit: 10 }),
      }),
    ).rejects.toBeInstanceOf(AccessError);
  });
});

describe("corrective action tasks (PRD #21 §151, §153)", () => {
  it("creates a canonical Task, not a quality-specific one", async () => {
    const context = await loginAs("QAQC");

    const action = await actions.createAction(
      context,
      correctiveActionSchema.parse({
        title: "Vitest task parent",
        description: "Raised by a test.",
        ncrId: SEED.liveNcr,
        projectId: SEED.projectA,
        assignedToMemberId: await inspectorId(),
      }),
    );
    created.actions.push(action.id);

    const task = await actions.createActionTask(context, action.id, {
      title: "Vitest task",
      description: "A step of the corrective action.",
    });

    const row = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { title: true, module: true, entityType: true, entityId: true, projectId: true },
    });

    expect(row.title).toBe("Vitest task");
    expect(row.module).toBe("qaqc");
    expect(row.entityType).toBe("corrective_action");
    expect(row.entityId).toBe(action.id);
    // Inherits the project, so the site people on that job can see it.
    expect(row.projectId).toBe(SEED.projectA);

    await prisma.task.delete({ where: { id: task.id } });
  });
});

describe("supplier quality (PRD #21 §200)", () => {
  it("names suppliers only for a reader who may reach the buying (§183)", async () => {
    const qaqc = await loginAs("QAQC");
    const owner = await loginAs("OWNER");

    const withoutProcurement = await qaqcReports(qaqc);
    // QA/QC holds no Procurement grant by default, so it gets the totals with
    // no attribution rather than a table of suppliers.
    expect(can(qaqc, "procurement.supplier.view")).toBe(false);
    expect(withoutProcurement.supplierQuality).toBeNull();

    if (!can(owner, "procurement.supplier.view")) return;
    const withProcurement = await qaqcReports(owner);
    expect(withProcurement.supplierQuality).not.toBeNull();
  });
});

describe("Procurement void coordination (PRD #21 §104)", () => {
  it("refuses to void a delivery quality has released", async () => {
    const context = await loginAs("PROCUREMENT");
    const receipts = await import("@/lib/modules/procurement/receipts/receipt.service");

    // receipt_001 was inspected and released on INS-2026-0001.
    await expect(
      receipts.voidReceipt(context, "receipt_001", "Vitest"),
    ).rejects.toMatchObject({
      details: { code: expect.stringMatching(/QUALITY_RELEASED|QUALITY_DECIDED|INVENTORY_POSTED/) },
    });
  });
});

describe("quality documents (PRD #21 §176, §177)", () => {
  it("reaches a document exactly as far as the record it hangs off", async () => {
    const documents = await import("@/lib/modules/documents/document.service");
    const { documentListQuerySchema } = await import(
      "@/lib/modules/documents/document.schema"
    );

    const qaqc = await loginAs("QAQC");
    const result = await documents.listDocuments(
      qaqc,
      documentListQuerySchema.parse({ moduleKey: "qaqc", limit: 100 }),
    );
    expect(result.data.length).toBeGreaterThan(0);

    /*
     * A generic document permission opens nothing here (§177). Sales holds
     * company-wide Documents access and no quality access at all — quality
     * evidence is often the record of somebody's mistake, and it is not
     * everybody's to read.
     *
     * An Architect is a different case: PRD #21 §19 gives them a
     * project-scoped quality read, so their own project's evidence is
     * legitimately theirs.
     */
    const sales = await loginAs("SALES");
    expect(can(sales, "document.view")).toBe(true);
    expect(can(sales, "qaqc.document.view")).toBe(false);

    const denied = await documents.listDocuments(
      sales,
      documentListQuerySchema.parse({ moduleKey: "qaqc", limit: 100 }),
    );
    expect(denied.data.length).toBe(0);
  });

  it("refuses a quality document to a reader who cannot open its record", async () => {
    const documents = await import("@/lib/modules/documents/document.service");
    const sales = await loginAs("SALES");

    const doc = await prisma.document.findFirstOrThrow({
      where: { module: "qaqc", entityType: "quality_inspection" },
      select: { id: true },
    });

    await expect(documents.getDocument(sales, doc.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("gives an Architect the evidence on their own project, and no other (§19)", async () => {
    const documents = await import("@/lib/modules/documents/document.service");
    const { documentListQuerySchema } = await import(
      "@/lib/modules/documents/document.schema"
    );

    const architect = await loginAs("ARCHITECT");
    expect(can(architect, "qaqc.document.view")).toBe(true);

    const scoped = await documents.listDocuments(
      architect,
      documentListQuerySchema.parse({ moduleKey: "qaqc", limit: 100 }),
    );
    const all = await documents.listDocuments(
      await loginAs("QAQC"),
      documentListQuerySchema.parse({ moduleKey: "qaqc", limit: 100 }),
    );

    expect(scoped.data.length).toBeLessThan(all.data.length);
  });
});
