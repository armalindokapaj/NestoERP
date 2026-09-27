import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as hseActions from "@/lib/actions/hse";
import * as qaqcActions from "@/lib/actions/qaqc";
import * as hseIncidents from "@/lib/modules/hse/incidents/incident.service";
import * as hseInspections from "@/lib/modules/hse/inspections/inspection.service";
import { incidentSchema, inspectionSchema as hseInspectionSchema, permitSchema, riskAssessmentSchema, submitInspectionSchema as hseSubmitSchema } from "@/lib/modules/hse/hse.schema";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import * as correctiveActions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as qaqcInspections from "@/lib/modules/qaqc/inspections/inspection.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import { correctiveActionSchema, inspectionSchema as qaqcInspectionSchema, ncrSchema, submitInspectionSchema as qaqcSubmitSchema } from "@/lib/modules/qaqc/qaqc.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { disconnectLocker, shownCycle } from "./aud10-cycles";
import { asPerson, fromAction, snapshot, sourceGuardTests, type SourceScenario } from "./aud10-scenarios";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * QA/QC and HSE decisions name the cycle their page shows (AUD-10 §4, CW-02,
 * CW-04, CW-05; gaps A1, A6, A12, A13): quality inspections and NCR
 * closures; safety inspections, risk assessments, permits and incident
 * closures.
 */

const PREFIX = "aud10a_";
const made = {
  qaqcInspections: new Set<string>(),
  ncrs: new Set<string>(),
  qaqcActions: new Set<string>(),
  hseInspections: new Set<string>(),
  assessments: new Set<string>(),
  permits: new Set<string>(),
  incidents: new Set<string>(),
};

afterEach(async () => {
  const all = Object.values(made).flatMap((set) => [...set]);
  if (all.length === 0) return;
  await prisma.notification.deleteMany({ where: { entityId: { in: all } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: all } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: all } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: all } } });
  // QA/QC
  await prisma.qualityApproval.deleteMany({ where: { recordId: { in: [...made.qaqcInspections, ...made.ncrs] } } });
  await prisma.correctiveAction.deleteMany({ where: { OR: [{ id: { in: [...made.qaqcActions] } }, { ncrId: { in: [...made.ncrs] } }] } });
  await prisma.nonConformanceReport.deleteMany({ where: { id: { in: [...made.ncrs] } } });
  await prisma.inspectionChecklistItem.deleteMany({ where: { inspectionId: { in: [...made.qaqcInspections] } } });
  await prisma.qualityInspection.deleteMany({ where: { id: { in: [...made.qaqcInspections] } } });
  // HSE
  await prisma.hseApproval.deleteMany({ where: { recordId: { in: [...made.hseInspections, ...made.assessments, ...made.permits, ...made.incidents] } } });
  await prisma.hseAction.deleteMany({ where: { OR: [{ inspectionId: { in: [...made.hseInspections] } }, { permitId: { in: [...made.permits] } }, { riskAssessmentId: { in: [...made.assessments] } }, { incidentId: { in: [...made.incidents] } }] } });
  await prisma.hseInspectionChecklistItem.deleteMany({ where: { inspectionId: { in: [...made.hseInspections] } } });
  await prisma.hseInspection.deleteMany({ where: { id: { in: [...made.hseInspections] } } });
  await prisma.hseWorkPermit.deleteMany({ where: { id: { in: [...made.permits] } } });
  await prisma.hseRiskAssessmentItem.deleteMany({ where: { riskAssessmentId: { in: [...made.assessments] } } });
  await prisma.hseRiskAssessment.deleteMany({ where: { id: { in: [...made.assessments] } } });
  await prisma.hseIncident.deleteMany({ where: { id: { in: [...made.incidents] } } });
  for (const set of Object.values(made)) set.clear();
});

afterAll(async () => {
  await disconnectLocker();
  await cleanupSessions();
  await prisma.$disconnect();
});

const owner = () => loginAs("OWNER");
const qaqc = () => loginAs("QAQC");
const hse = () => loginAs("HSE");

/* QA/QC -------------------------------------------------------------------- */

async function answerAndSubmitQuality(inspectionId: string): Promise<void> {
  const context = await qaqc();
  const detail = await qaqcInspections.getInspection(context, inspectionId);
  await qaqcInspections.saveChecklist(context, inspectionId, {
    answers: detail.checklist.map((item) => ({ itemId: item.id, result: "PASS" as const, responseValue: "38", note: undefined })),
  });
  await qaqcInspections.submitInspection(context, inspectionId, qaqcSubmitSchema.parse({ result: "PASS" }));
}

const qualityInspection: SourceScenario = {
  label: "qaqc inspection",
  module: "qaqc",
  providerKey: "qaqc",
  sourceTable: "quality_inspections",
  approver: owner,
  async createSubmitted() {
    const context = await qaqc();
    const created = await qaqcInspections.createInspection(
      context,
      qaqcInspectionSchema.parse({ inspectionType: "WORK", templateId: "tpl_concrete", projectId: "project_a", assignedInspectorMemberId: context.membershipId }),
    );
    made.qaqcInspections.add(created.id);
    await answerAndSubmitQuality(created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => qaqcActions.inspectionLifecycleAction(id, "approve", null, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => qaqcActions.inspectionLifecycleAction(id, "reject", `${PREFIX}measurements not recorded`, cycle))),
  async resubmit(id) {
    await qaqcInspections.reworkInspection(await qaqc(), id);
    await answerAndSubmitQuality(id);
  },
  status: async (id) => (await prisma.qualityInspection.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "QAQC_INSPECTION_APPROVED",
};

const ncr: SourceScenario = {
  label: "qaqc ncr closure",
  module: "qaqc",
  providerKey: "qaqc",
  sourceTable: "non_conformance_reports",
  approver: owner,
  async createSubmitted() {
    const context = await qaqc();
    const created = await ncrs.createNcr(
      context,
      ncrSchema.parse({ title: `${PREFIX}ncr`, description: "Raised by a test.", category: "PROCESS", severity: "LOW", rootCause: "A cause, written down.", projectId: "project_a" }),
    );
    made.ncrs.add(created.id);
    await ncrs.openNcr(context, created.id);
    const action = await correctiveActions.createAction(
      context,
      correctiveActionSchema.parse({ title: `${PREFIX}action`, description: "Raised by a test.", ncrId: created.id, assignedToMemberId: context.membershipId }),
    );
    made.qaqcActions.add(action.id);
    await correctiveActions.completeAction(context, action.id, "Done.");
    await correctiveActions.verifyAction(await owner(), action.id, "Checked.");
    await ncrs.submitNcr(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => qaqcActions.ncrLifecycleAction(id, "approve", null, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => qaqcActions.ncrLifecycleAction(id, "reject", `${PREFIX}closure evidence thin`, cycle))),
  resubmit: async (id) => ncrs.submitNcr(await qaqc(), id),
  status: async (id) => (await prisma.nonConformanceReport.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED_FOR_CLOSE",
  approvedActivity: "QAQC_NCR_APPROVED",
};

/* HSE ------------------------------------------------------------------------ */

async function startAndSubmitSafety(inspectionId: string): Promise<void> {
  const context = await hse();
  await hseInspections.startInspection(context, inspectionId);
  await hseInspections.submitInspection(context, inspectionId, hseSubmitSchema.parse({ result: "PASS" }));
}

const safetyInspection: SourceScenario = {
  label: "hse inspection",
  module: "hse",
  providerKey: "hse",
  sourceTable: "hse_inspections",
  approver: owner,
  async createSubmitted() {
    const context = await hse();
    const created = await hseInspections.createInspection(
      context,
      hseInspectionSchema.parse({ inspectionType: "GENERAL", projectId: "project_a", assignedInspectorMemberId: context.membershipId }),
    );
    made.hseInspections.add(created.id);
    await startAndSubmitSafety(created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => hseActions.approveInspectionAction(id, "", cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => hseActions.rejectInspectionAction(id, `${PREFIX}photos missing`, cycle))),
  resubmit: startAndSubmitSafety,
  status: async (id) => (await prisma.hseInspection.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "HSE_INSPECTION_APPROVED",
};

const assessment: SourceScenario = {
  label: "hse risk assessment",
  module: "hse",
  providerKey: "hse",
  sourceTable: "hse_risk_assessments",
  approver: owner,
  async createSubmitted() {
    const context = await hse();
    const created = await risk.createRiskAssessment(
      context,
      riskAssessmentSchema.parse({
        title: `${PREFIX}assessment`,
        projectId: "project_a",
        assessmentDate: "2026-09-01",
        items: [{ hazardDescription: `${PREFIX}working at height`, likelihood: "3", severity: "4" }],
      }),
    );
    made.assessments.add(created.id);
    await risk.submitRiskAssessment(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => hseActions.approveRiskAssessmentAction(id, "", cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => hseActions.rejectRiskAssessmentAction(id, `${PREFIX}controls too thin`, cycle))),
  resubmit: async (id) => risk.submitRiskAssessment(await hse(), id),
  status: async (id) => (await prisma.hseRiskAssessment.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "HSE_RISK_ASSESSMENT_APPROVED",
};

const permit: SourceScenario = {
  label: "hse permit",
  module: "hse",
  providerKey: "hse",
  sourceTable: "hse_work_permits",
  approver: owner,
  async createSubmitted() {
    const context = await hse();
    const created = await permits.createPermit(
      context,
      permitSchema.parse({
        permitType: "LIFTING",
        title: `${PREFIX}permit`,
        projectId: "project_a",
        locationText: "Crane base",
        validFrom: new Date(Date.now() - 3_600_000).toISOString(),
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    made.permits.add(created.id);
    await permits.submitPermit(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => hseActions.approvePermitAction(id, "", cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => hseActions.rejectPermitAction(id, `${PREFIX}lift plan missing`, cycle))),
  resubmit: async (id) => permits.submitPermit(await hse(), id),
  status: async (id) => (await prisma.hseWorkPermit.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "HSE_PERMIT_APPROVED",
};

/**
 * An incident closure has no "reject" (PRD #22 §96): the cycle that follows a
 * decided one is the closure sought again after the incident is reopened. So
 * "sending it back" here is closing it and reopening it, and the stale page is
 * the one still showing the first closure request.
 */
const incident: SourceScenario = {
  label: "hse incident closure",
  module: "hse",
  providerKey: "hse",
  sourceTable: "hse_incidents",
  approver: owner,
  async createSubmitted() {
    const context = await hse();
    const created = await hseIncidents.createIncident(
      context,
      incidentSchema.parse({
        incidentType: "INCIDENT",
        title: `${PREFIX}incident`,
        description: "A board slipped; nobody hurt.",
        projectId: "project_a",
        occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
        severity: "LOW",
      }),
    );
    made.incidents.add(created.id);
    await hseIncidents.startInvestigation(context, created.id);
    await hseIncidents.submitIncidentClose(context, created.id, `${PREFIX}cause understood`);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => hseActions.closeIncidentAction(id, "", cycle))),
  async sendBack(id, cycle) {
    const closed = fromAction(await asPerson(await owner(), () => hseActions.closeIncidentAction(id, "", cycle)));
    if (closed.ok) await hseIncidents.reopenIncident(await owner(), id, `${PREFIX}a second board slipped`);
    return closed;
  },
  async resubmit(id) {
    const context = await hse();
    await hseIncidents.startInvestigation(context, id);
    await hseIncidents.submitIncidentClose(context, id, `${PREFIX}boards re-fixed`);
  },
  status: async (id) => (await prisma.hseIncident.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "CLOSED",
  approvedActivity: "HSE_INCIDENT_CLOSED",
};

const tracker = { track: () => undefined };

for (const scenario of [qualityInspection, ncr, safetyInspection, assessment, permit, incident]) {
  describe(`${scenario.label} (AUD-10 §4)`, () => {
    sourceGuardTests(scenario, tracker);
  });
}

describe("the HSE queue decides the row it shows (AUD-10 §4, CW-05)", () => {
  it("a queue row left open across a send-back and resubmission cannot decide the new permit cycle", async () => {
    const id = await permit.createSubmitted();
    const row = await prisma.hseApproval.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });
    await permits.rejectPermit(await owner(), id, `${PREFIX}send back`, { approvalId: row.id });
    await permit.resubmit(id);
    const before = await snapshot(permit, id);
    // Exactly what components/hse/approval-queue.tsx sends: the row's approval id.
    const stale = fromAction(await asPerson(await owner(), () => hseActions.approvePermitAction(id, "", { approvalId: row.id })));
    expect(stale).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    expect(await snapshot(permit, id)).toEqual(before);
  });
});

describe("a risk assessment decision moves only an assessment still waiting (AUD-10 §4, A12)", () => {
  it("refuses to approve over an assessment that left PENDING_APPROVAL by another road, writing nothing", async () => {
    const id = await assessment.createSubmitted();
    const cycle = await shownCycle("hse", id);
    // The assessment moved on outside the approval (a direct write standing in for any other writer).
    await prisma.hseRiskAssessment.update({ where: { id }, data: { status: "DRAFT" } });
    const before = await snapshot(assessment, id);
    await expect(risk.approveRiskAssessment(await owner(), id, null, cycle)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await snapshot(assessment, id)).toEqual(before);
    expect(await assessment.status(id)).toBe("DRAFT");
  });
});

describe("saying no needs a reason at the service (AUD-10 §4, A13)", () => {
  it("refuses QA/QC and HSE rejections with a blank reason, even with the cycle named", async () => {
    const context = await owner();
    const quality = await qualityInspection.createSubmitted();
    const safety = await safetyInspection.createSubmitted();
    const permitId = await permit.createSubmitted();
    const refusal = { code: "VALIDATION_ERROR", details: { code: "APPROVAL_REASON_REQUIRED" } };
    await expect(qaqcInspections.rejectInspection(context, quality, " ", await shownCycle("qaqc", quality))).rejects.toMatchObject(refusal);
    await expect(hseInspections.rejectInspection(context, safety, "", await shownCycle("hse", safety))).rejects.toMatchObject(refusal);
    await expect(permits.rejectPermit(context, permitId, "  ", await shownCycle("hse", permitId))).rejects.toMatchObject(refusal);
    expect(await qualityInspection.status(quality)).toBe("PENDING_APPROVAL");
    expect(await safetyInspection.status(safety)).toBe("PENDING_APPROVAL");
    expect(await permit.status(permitId)).toBe("PENDING_APPROVAL");
  });
});
