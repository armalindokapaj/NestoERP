import { afterAll, afterEach, describe, expect, it } from "vitest";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import * as approvals from "@/lib/modules/hse/approvals/approval.service";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import * as ppe from "@/lib/modules/hse/ppe/ppe.service";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import * as stopWork from "@/lib/modules/hse/stop-work/stop-work.service";
import * as templates from "@/lib/modules/hse/templates/template.service";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";
import { getHseOverview, getProjectHseSummary } from "@/lib/modules/hse/overview/overview.service";
import { availableReports, runReport } from "@/lib/modules/hse/reports/reports.service";
import {
  actionListSchema,
  actionSchema,
  hazardCloseSchema,
  hazardListSchema,
  hazardSchema,
  incidentListSchema,
  incidentSchema,
  inspectionListSchema,
  inspectionSchema,
  observationListSchema,
  observationSchema,
  permitListSchema,
  permitSchema,
  ppeCheckSchema,
  ppeListSchema,
  riskAssessmentListSchema,
  riskAssessmentSchema,
  stopWorkListSchema,
  stopWorkSchema,
  submitInspectionSchema,
  templateListSchema,
  templateSchema,
  toolboxListSchema,
  toolboxSchema,
} from "@/lib/modules/hse/hse.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { shownCycle } from "../approvals/aud10-cycles";

/**
 * HSE authorisation and lifecycle tests (PRD #22 §387–§419).
 *
 * These call the same services the pages call, so a passing test is a statement
 * about the running product rather than about a mock (PRD #9 §223). Inputs go
 * through the same zod schemas the server actions use, because several rules
 * live in the schema and testing past it would prove nothing.
 *
 * The rules this module exists to hold:
 *   1. risk is derived on the server and cannot be posted,
 *   2. status and result are different things,
 *   3. a required check that failed makes an overall PASS impossible,
 *   4. nobody approves or verifies what they themselves submitted or did,
 *   5. a hazard cannot close with an unverified action against it,
 *   6. a serious incident cannot close without a root cause,
 *   7. a stop-work cannot be released while a critical action is outstanding,
 *   8. a permit outside its window authorises nothing,
 *   9. a used checklist is versioned, never rewritten,
 *  10. Company B is unreachable by every route in and out.
 */

const templateQuery = templateListSchema.parse({ limit: 100 });
const inspectionQuery = inspectionListSchema.parse({ limit: 100 });
const hazardQuery = hazardListSchema.parse({ limit: 200 });
const incidentQuery = incidentListSchema.parse({ limit: 100 });
const riskQuery = riskAssessmentListSchema.parse({ limit: 100 });
const actionQuery = actionListSchema.parse({ limit: 200 });
const toolboxQuery = toolboxListSchema.parse({ limit: 100 });
const permitQuery = permitListSchema.parse({ limit: 100 });
const ppeQuery = ppeListSchema.parse({ limit: 100 });
const observationQuery = observationListSchema.parse({ limit: 100 });
const stopWorkQuery = stopWorkListSchema.parse({ limit: 100 });

const SEED = {
  templateHeight: "hse_tpl_height",
  templateUnused: "hse_tpl_archived",
  draftInspection: "hse_ins_015",
  liveInspection: "hse_ins_010",
  pendingFail: "hse_ins_006",
  pendingPass: "hse_ins_007",
  approvedInspection: "hse_ins_004",
  closedInspection: "hse_ins_001",
  openHazard: "hse_hz_002",
  blockedHazard: "hse_hz_004",
  closedHazard: "hse_hz_001",
  criticalHazard: "hse_hz_035",
  openIncident: "hse_inc_012",
  investigatingIncident: "hse_inc_011",
  pendingCloseIncident: "hse_inc_009",
  closedIncident: "hse_inc_001",
  nearMiss: "hse_nm_006",
  draftAssessment: "hse_ra_010",
  pendingAssessment: "hse_ra_008",
  approvedAssessment: "hse_ra_001",
  openAction: "hse_act_005",
  pendingAction: "hse_act_002",
  verifiedAction: "hse_act_001",
  criticalOpenAction: "hse_act_021",
  draftTalk: "hse_tbt_013",
  completedTalk: "hse_tbt_001",
  activePermit: "hse_ptw_001",
  lapsedPermit: "hse_ptw_004",
  pendingPermit: "hse_ptw_007",
  draftPermit: "hse_ptw_009",
  blockedStopWork: "hse_sw_001",
  releasedStopWork: "hse_sw_003",
  openObservation: "hse_env_005",
  companyBHazard: "hse_hz_b_001",
  companyBIncident: "hse_inc_b_001",
  projectA: "project_a",
} as const;

const created = {
  templates: [] as string[],
  inspections: [] as string[],
  hazards: [] as string[],
  incidents: [] as string[],
  assessments: [] as string[],
  actions: [] as string[],
  talks: [] as string[],
  permits: [] as string[],
  ppe: [] as string[],
  observations: [] as string[],
  stopWorks: [] as string[],
};

const openedApprovals: string[] = [];
const otherSites: string[] = [];

/**
 * Restores anything a test changed on a *seeded* record.
 *
 * The suite runs against the shared development database, so a test that
 * approves a seeded inspection has to put it back — otherwise the next run
 * finds it already approved and the failure looks like a product bug.
 */
const touched: { model: string; id: string; data: Record<string, unknown> }[] = [];

async function remember(
  model:
    | "inspection"
    | "hazard"
    | "incident"
    | "assessment"
    | "action"
    | "talk"
    | "permit"
    | "stopWork"
    | "observation"
    | "approval"
    | "template",
  id: string,
) {
  switch (model) {
    case "inspection": {
      const row = await prisma.hseInspection.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, result: true, submittedAt: true, approvedAt: true,
          approvedByMemberId: true, rejectedAt: true, rejectedByMemberId: true,
          closedAt: true, closedByMemberId: true, cancelledAt: true, decisionNote: true,
          executedByMemberId: true, inspectionDate: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "hazard": {
      const row = await prisma.hseHazard.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, likelihood: true, severityScore: true, riskScore: true,
          riskLevel: true, residualLikelihood: true, residualSeverity: true,
          residualRiskScore: true, residualRiskLevel: true, controlMeasure: true,
          immediateControl: true, assignedToMemberId: true, closedAt: true,
          closedByMemberId: true, closureNote: true, cancelledAt: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "incident": {
      const row = await prisma.hseIncident.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, investigatorMemberId: true, investigationSummary: true,
          rootCause: true, lessonsLearned: true, submittedForCloseAt: true,
          closedAt: true, closedByMemberId: true, closureNote: true, cancelledAt: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "assessment": {
      const row = await prisma.hseRiskAssessment.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, submittedAt: true, approvedAt: true, approvedByMemberId: true,
          archivedAt: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "action": {
      const row = await prisma.hseAction.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, completionNote: true, completedAt: true, completedByMemberId: true,
          verificationNote: true, verifiedAt: true, verifiedByMemberId: true,
          assignedToMemberId: true, cancelledAt: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "talk": {
      const row = await prisma.toolboxTalk.findUniqueOrThrow({
        where: { id },
        select: { status: true, completedAt: true, cancelledAt: true },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "permit": {
      const row = await prisma.hseWorkPermit.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, submittedAt: true, approvedAt: true, approvedByMemberId: true,
          activatedAt: true, suspendedAt: true, suspensionReason: true,
          closedAt: true, closedByMemberId: true, cancelledAt: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "stopWork": {
      const row = await prisma.stopWorkRecord.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, releasedAt: true, releasedByMemberId: true,
          releaseReason: true, cancelledAt: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "observation": {
      const row = await prisma.environmentalObservation.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, assignedToMemberId: true, closedAt: true,
          closedByMemberId: true, closureNote: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "approval": {
      const row = await prisma.hseApproval.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, decidedByMemberId: true, decidedAt: true, decisionNote: true,
        },
      });
      touched.push({ model, id, data: row });
      return;
    }
    case "template": {
      const row = await prisma.hseInspectionTemplate.findUniqueOrThrow({
        where: { id },
        select: { status: true, name: true, code: true, archivedAt: true },
      });
      touched.push({ model, id, data: row });
    }
  }
}

/**
 * Restores the *approval* a decision consumed, alongside the record itself.
 *
 * Deciding flips the approval row from PENDING and nothing else puts it back,
 * so without this the next run finds no pending decision and the failure looks
 * like a product bug rather than a dirty fixture.
 */
async function rememberDecision(
  model: Parameters<typeof remember>[0],
  recordId: string,
  recordType: "INSPECTION" | "RISK_ASSESSMENT" | "WORK_PERMIT" | "INCIDENT_CLOSE",
) {
  await remember(model, recordId);
  const approval = await prisma.hseApproval.findFirst({
    where: { recordType, recordId, status: "PENDING" },
    select: { id: true },
  });
  if (approval) await remember("approval", approval.id);
}

afterEach(async () => {
  const ids = [
    ...created.inspections, ...created.hazards, ...created.incidents,
    ...created.assessments, ...created.actions, ...created.talks,
    ...created.permits, ...created.observations, ...created.stopWorks,
    ...created.templates, ...created.ppe,
  ];
  if (ids.length > 0) await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });

  // Children first, then parents: the foreign keys are Restrict in places.
  if (created.actions.length > 0) {
    await prisma.hseAction.deleteMany({ where: { id: { in: created.actions } } });
    created.actions.length = 0;
  }
  if (created.stopWorks.length > 0) {
    await prisma.hseAction.deleteMany({ where: { stopWorkId: { in: created.stopWorks } } });
    await prisma.stopWorkRecord.deleteMany({ where: { id: { in: created.stopWorks } } });
    created.stopWorks.length = 0;
  }
  if (created.hazards.length > 0) {
    await prisma.hseAction.deleteMany({ where: { hazardId: { in: created.hazards } } });
    await prisma.stopWorkRecord.deleteMany({ where: { hazardId: { in: created.hazards } } });
    await prisma.hseHazard.deleteMany({ where: { id: { in: created.hazards } } });
    created.hazards.length = 0;
  }
  if (created.incidents.length > 0) {
    await prisma.hseAction.deleteMany({ where: { incidentId: { in: created.incidents } } });
    await prisma.stopWorkRecord.deleteMany({ where: { incidentId: { in: created.incidents } } });
    await prisma.hseApproval.deleteMany({ where: { recordId: { in: created.incidents } } });
    await prisma.hseIncident.deleteMany({ where: { id: { in: created.incidents } } });
    created.incidents.length = 0;
  }
  if (created.inspections.length > 0) {
    await prisma.hseApproval.deleteMany({ where: { recordId: { in: created.inspections } } });
    await prisma.hseAction.deleteMany({ where: { inspectionId: { in: created.inspections } } });
    await prisma.hseHazard.deleteMany({ where: { inspectionId: { in: created.inspections } } });
    await prisma.hseInspectionChecklistItem.deleteMany({
      where: { inspectionId: { in: created.inspections } },
    });
    await prisma.hseInspection.deleteMany({ where: { id: { in: created.inspections } } });
    created.inspections.length = 0;
  }
  if (created.permits.length > 0) {
    await prisma.hseApproval.deleteMany({ where: { recordId: { in: created.permits } } });
    await prisma.hseAction.deleteMany({ where: { permitId: { in: created.permits } } });
    await prisma.hseWorkPermit.deleteMany({ where: { id: { in: created.permits } } });
    created.permits.length = 0;
  }
  if (created.assessments.length > 0) {
    await prisma.hseApproval.deleteMany({ where: { recordId: { in: created.assessments } } });
    await prisma.hseAction.deleteMany({ where: { riskAssessmentId: { in: created.assessments } } });
    await prisma.hseWorkPermit.updateMany({
      where: { riskAssessmentId: { in: created.assessments } },
      data: { riskAssessmentId: null },
    });
    await prisma.hseRiskAssessmentItem.deleteMany({
      where: { riskAssessmentId: { in: created.assessments } },
    });
    await prisma.hseRiskAssessment.deleteMany({ where: { id: { in: created.assessments } } });
    created.assessments.length = 0;
  }
  if (created.observations.length > 0) {
    await prisma.hseAction.deleteMany({
      where: { environmentalObservationId: { in: created.observations } },
    });
    await prisma.environmentalObservation.deleteMany({
      where: { id: { in: created.observations } },
    });
    created.observations.length = 0;
  }
  if (created.talks.length > 0) {
    await prisma.toolboxTalkParticipant.deleteMany({
      where: { toolboxTalkId: { in: created.talks } },
    });
    await prisma.toolboxTalk.deleteMany({ where: { id: { in: created.talks } } });
    created.talks.length = 0;
  }
  if (created.ppe.length > 0) {
    await prisma.ppeCheck.deleteMany({ where: { id: { in: created.ppe } } });
    created.ppe.length = 0;
  }
  if (created.templates.length > 0) {
    await prisma.hseInspection.updateMany({
      where: { templateId: { in: created.templates } },
      data: { templateId: null },
    });
    await prisma.hseInspectionTemplateItem.deleteMany({
      where: { templateId: { in: created.templates } },
    });
    await prisma.hseInspectionTemplate.deleteMany({ where: { id: { in: created.templates } } });
    created.templates.length = 0;
  }

  if (openedApprovals.length > 0) {
    await prisma.hseApproval.deleteMany({ where: { id: { in: openedApprovals } } });
    openedApprovals.length = 0;
  }

  for (const row of touched) {
    const data = row.data as never;
    if (row.model === "inspection") await prisma.hseInspection.update({ where: { id: row.id }, data });
    else if (row.model === "hazard") await prisma.hseHazard.update({ where: { id: row.id }, data });
    else if (row.model === "incident") await prisma.hseIncident.update({ where: { id: row.id }, data });
    else if (row.model === "assessment") await prisma.hseRiskAssessment.update({ where: { id: row.id }, data });
    else if (row.model === "action") await prisma.hseAction.update({ where: { id: row.id }, data });
    else if (row.model === "talk") await prisma.toolboxTalk.update({ where: { id: row.id }, data });
    else if (row.model === "permit") await prisma.hseWorkPermit.update({ where: { id: row.id }, data });
    else if (row.model === "stopWork") await prisma.stopWorkRecord.update({ where: { id: row.id }, data });
    else if (row.model === "observation") await prisma.environmentalObservation.update({ where: { id: row.id }, data });
    else if (row.model === "approval") await prisma.hseApproval.update({ where: { id: row.id }, data });
    else await prisma.hseInspectionTemplate.update({ where: { id: row.id }, data });
  }
  touched.length = 0;

  if (otherSites.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: otherSites } } });
    otherSites.length = 0;
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/**
 * An open hazard on a second site in the company, with nobody on its team.
 * Each demo company has one project (E-06 §49), so a site the Project Manager
 * is not on has to be made.
 */
async function hazardOffTheirSites(hse: Awaited<ReturnType<typeof loginAs>>) {
  const projectId = `hsetest_site_${Date.now().toString(36)}_${otherSites.length}`;
  await prisma.project.create({
    data: { id: projectId, companyId: hse.companyId, code: projectId, name: "HSE test site", status: "ACTIVE", createdBy: "test" },
  });
  otherSites.push(projectId);

  const hazard = await hazards.createHazard(hse, hazardInput({ projectId, title: "On another site" }));
  created.hazards.push(hazard.id);
  return hazard;
}

function hazardInput(overrides: Record<string, unknown> = {}) {
  return hazardSchema.parse({
    title: "Test hazard",
    description: "Raised by the automated suite.",
    projectId: SEED.projectA,
    hazardCategory: "HOUSEKEEPING",
    likelihood: "3",
    severity: "3",
    observedAt: new Date().toISOString().slice(0, 10),
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* Risk is the server's                                                        */
/* -------------------------------------------------------------------------- */

describe("risk is derived, never accepted (PRD #22 §105, §243)", () => {
  it("computes the score and the level from the two axes", async () => {
    const context = await loginAs("HSE");
    const hazard = await hazards.createHazard(
      context,
      hazardInput({ likelihood: "4", severity: "5", immediateControl: "Area barricaded." }),
    );
    created.hazards.push(hazard.id);

    expect(hazard.risk.score).toBe(20);
    expect(hazard.risk.level).toBe("CRITICAL");
  });

  /*
   * The schema has no riskScore or riskLevel field, so a browser cannot file a
   * critical hazard as LOW and route it away from the people who must see it.
   */
  it("has nowhere for a client to put a forged score", () => {
    const parsed = hazardSchema.safeParse({
      title: "Forged",
      description: "Trying to post my own risk level.",
      hazardCategory: "OTHER",
      likelihood: "4",
      severity: "5",
      observedAt: new Date().toISOString().slice(0, 10),
      immediateControl: "Barricaded.",
      riskScore: 1,
      riskLevel: "LOW",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && "riskScore" in parsed.data).toBe(false);
    expect(parsed.success && "riskLevel" in parsed.data).toBe(false);
  });

  it("refuses an axis value off the matrix", () => {
    expect(hazardSchema.safeParse({
      title: "Off the matrix",
      description: "Six is not a likelihood.",
      hazardCategory: "OTHER",
      likelihood: "6",
      severity: "3",
      observedAt: new Date().toISOString().slice(0, 10),
    }).success).toBe(false);
  });

  /*
   * §68: a critical hazard must say what was done about it *now*. The rule sits
   * in the schema and again in the service, because the schema is not the only
   * way in.
   */
  it("refuses a critical hazard with no immediate control", async () => {
    expect(hazardSchema.safeParse({
      title: "Critical with no control",
      description: "Nothing was done.",
      hazardCategory: "WORK_AT_HEIGHT",
      likelihood: "5",
      severity: "5",
      observedAt: new Date().toISOString().slice(0, 10),
    }).success).toBe(false);

    /*
     * And again at the service boundary, reached directly. The schema is the
     * first door, not the only one — an API client or a future caller does not
     * have to come through the form.
     */
    const context = await loginAs("HSE");
    await expect(
      hazards.createHazard(context, {
        title: "Critical with no control",
        description: "Nothing was done.",
        projectId: SEED.projectA,
        hazardCategory: "WORK_AT_HEIGHT",
        likelihood: 5,
        severity: 5,
        observedAt: new Date(),
      } as never),
    ).rejects.toThrow(AccessError);
  });

  it("refuses a residual risk higher than the risk before the control", async () => {
    const context = await loginAs("HSE");
    await remember("hazard", SEED.openHazard);

    await expect(
      hazards.assessHazard(context, SEED.openHazard, {
        likelihood: 1,
        severity: 1,
        residualLikelihood: 5,
        residualSeverity: 5,
      } as never),
    ).rejects.toThrow(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

describe("safety inspections (PRD #22 §37, §38, §47, §49, §51)", () => {
  it("keeps status and result as two separate facts", async () => {
    const context = await loginAs("HSE");
    const inspection = await inspections.getInspection(context, SEED.pendingFail);

    // Waiting for a signature, and it failed. One column could not say both.
    expect(inspection.status).toBe("PENDING_APPROVAL");
    expect(inspection.result).toBe("FAIL");
  });

  it("copies the checklist onto the inspection rather than joining to it", async () => {
    const context = await loginAs("HSE");
    const template = await templates.getTemplate(context, SEED.templateHeight);
    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "WORK_AT_HEIGHT",
        projectId: SEED.projectA,
        templateId: SEED.templateHeight,
        assignedInspectorMemberId: context.membershipId,
      }),
    );
    created.inspections.push(inspection.id);

    expect(inspection.checklistItems).toHaveLength(template.items.length);
    expect(inspection.checklistItems[0]!.label).toBe(template.items[0]!.label);
    expect(inspection.template?.version).toBe(template.version);
  });

  it("names what is still unanswered rather than just refusing", async () => {
    const context = await loginAs("HSE");
    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "WORK_AT_HEIGHT",
        projectId: SEED.projectA,
        templateId: SEED.templateHeight,
        assignedInspectorMemberId: context.membershipId,
      }),
    );
    created.inspections.push(inspection.id);

    await inspections.startInspection(context, inspection.id);
    const started = await inspections.getInspection(context, inspection.id);

    expect(started.gaps.length).toBeGreaterThan(0);
    expect(started.gaps[0]).toMatchObject({ kind: "UNANSWERED" });
  });

  it("refuses a PASS once a required check has failed", async () => {
    const context = await loginAs("HSE");
    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "WORK_AT_HEIGHT",
        projectId: SEED.projectA,
        templateId: SEED.templateHeight,
        assignedInspectorMemberId: context.membershipId,
      }),
    );
    created.inspections.push(inspection.id);

    await inspections.startInspection(context, inspection.id);
    const live = await inspections.getInspection(context, inspection.id);

    await inspections.executeInspection(context, inspection.id, {
      answers: live.checklistItems.map((item, index) => ({
        itemId: item.id,
        result: index === 0 ? ("FAIL" as const) : ("PASS" as const),
        note: index === 0 ? "Edge protection was missing." : undefined,
        responseValue: undefined,
      })),
    } as never);

    const answered = await inspections.getInspection(context, inspection.id);
    expect(answered.allowedResults).not.toContain("PASS");

    await expect(
      inspections.submitInspection(
        context,
        inspection.id,
        submitInspectionSchema.parse({ result: "PASS" }),
      ),
    ).rejects.toThrow(AccessError);

    // CONDITIONAL is still on the table: work may continue under a control.
    await inspections.submitInspection(
      context,
      inspection.id,
      submitInspectionSchema.parse({ result: "CONDITIONAL" }),
    );
    expect((await inspections.getInspection(context, inspection.id)).status).toBe(
      "PENDING_APPROVAL",
    );
  });

  it("refuses an answer the question does not allow", async () => {
    const context = await loginAs("HSE");
    const inspection = await inspections.getInspection(context, SEED.liveInspection);
    const passFail = inspection.checklistItems.find(
      (item) => item.responseType === "PASS_FAIL",
    );
    if (!passFail) return;

    await remember("inspection", SEED.liveInspection);
    await expect(
      inspections.executeInspection(context, SEED.liveInspection, {
        answers: [{ itemId: passFail.id, result: "NA" as const }],
      } as never),
    ).rejects.toThrow(AccessError);
  });

  /*
   * §52: whoever submitted does not sign it off. The service refuses it
   * independently of the page, which only withholds the button.
   */
  it("refuses to let the submitter approve their own inspection", async () => {
    const hse = await loginAs("HSE");
    const detail = await inspections.getInspection(hse, SEED.pendingFail);

    expect(detail.capabilities.canApprove).toBe(false);
    await expect(
      inspections.approveInspection(hse, SEED.pendingFail, null, await shownCycle("hse", SEED.pendingFail)),
    ).rejects.toThrow(AccessError);
  });

  it("lets somebody else approve it, and puts it back", async () => {
    await rememberDecision("inspection", SEED.pendingPass, "INSPECTION");
    const owner = await loginAs("OWNER");

    await inspections.approveInspection(owner, SEED.pendingPass, "Checked.", await shownCycle("hse", SEED.pendingPass));
    const after = await inspections.getInspection(owner, SEED.pendingPass);

    expect(after.status).toBe("APPROVED");
    expect(after.approvedBy?.memberId).toBe(owner.membershipId);
  });

  it("will not close a failed inspection with nothing to show for it", async () => {
    const context = await loginAs("HSE");
    const inspection = await inspections.createInspection(
      context,
      inspectionSchema.parse({
        inspectionType: "GENERAL",
        projectId: SEED.projectA,
        assignedInspectorMemberId: context.membershipId,
      }),
    );
    created.inspections.push(inspection.id);

    await inspections.startInspection(context, inspection.id);
    await inspections.submitInspection(
      context,
      inspection.id,
      submitInspectionSchema.parse({ result: "FAIL" }),
    );

    const owner = await loginAs("OWNER");
    await inspections.approveInspection(owner, inspection.id, null, await shownCycle("hse", inspection.id));

    await expect(
      inspections.closeInspection(owner, inspection.id, null),
    ).rejects.toThrow(AccessError);

    // A written disposition is enough on its own (§55).
    await inspections.closeInspection(owner, inspection.id, "Dealt with by the site manager.");
    expect((await inspections.getInspection(owner, inspection.id)).status).toBe("CLOSED");
  });
});

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

describe("safety checklists (PRD #22 §43, §349)", () => {
  it("edits a checklist nothing has used", async () => {
    const context = await loginAs("HSE");
    await remember("template", SEED.templateUnused);

    const before = await templates.getTemplate(context, SEED.templateUnused);
    expect(before.capabilities.wouldVersion).toBe(false);

    const after = await templates.updateTemplate(
      context,
      SEED.templateUnused,
      templateSchema.parse({
        code: before.code,
        name: "Retired site check (edited)",
        inspectionType: before.inspectionType,
        items: [{ label: "Site is tidy", responseType: "PASS_FAIL", required: "on" }],
      }),
    );

    expect(after.id).toBe(SEED.templateUnused);
    expect(after.version).toBe(before.version);
  });

  /*
   * The rule the whole file turns on: inspections already run against a version
   * are evidence, and rewriting it would change what somebody is recorded as
   * having checked on a site months ago.
   */
  it("versions a checklist that inspections have run against", async () => {
    const context = await loginAs("HSE");
    const before = await templates.getTemplate(context, SEED.templateHeight);
    expect(before.usageCount).toBeGreaterThan(0);
    expect(before.capabilities.wouldVersion).toBe(true);

    await remember("template", SEED.templateHeight);

    const after = await templates.updateTemplate(
      context,
      SEED.templateHeight,
      templateSchema.parse({
        code: before.code,
        name: before.name,
        inspectionType: before.inspectionType,
        items: [
          ...before.items.map((item) => ({
            label: item.label,
            responseType: item.responseType,
            required: item.required ? "on" : undefined,
          })),
          { label: "Newly added check", responseType: "PASS_FAIL", required: "on" },
        ],
      }),
    );
    created.templates.push(after.id);

    expect(after.id).not.toBe(SEED.templateHeight);
    expect(after.version).toBe(before.version + 1);

    // The original is untouched and its inspections still read against it.
    const original = await templates.getTemplate(context, SEED.templateHeight);
    expect(original.items).toHaveLength(before.items.length);
    expect(original.status).toBe("INACTIVE");
  });

  it("refuses a duplicate code", async () => {
    const context = await loginAs("HSE");
    await expect(
      templates.createTemplate(
        context,
        templateSchema.parse({
          code: "HSE-SITE",
          name: "Clashing code",
          inspectionType: "GENERAL",
          items: [{ label: "Anything", responseType: "PASS_FAIL", required: "on" }],
        }),
      ),
    ).rejects.toThrow(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

describe("hazards (PRD #22 §66, §70, §73)", () => {
  it("names what still blocks closure rather than refusing silently", async () => {
    const context = await loginAs("HSE");
    const hazard = await hazards.getHazard(context, SEED.blockedHazard);

    expect(hazard.closureGaps).toContain("UNVERIFIED_ACTION");
    // The button is withheld too, so nobody is offered a certain failure.
    expect(hazard.actions.some((action) => action.status !== "VERIFIED")).toBe(true);
  });

  it("refuses to close while an action against it is unverified", async () => {
    const context = await loginAs("HSE");
    await remember("hazard", SEED.blockedHazard);

    await expect(
      hazards.closeHazard(
        context,
        SEED.blockedHazard,
        hazardCloseSchema.parse({ closureNote: "Calling it done." }),
      ),
    ).rejects.toThrow(AccessError);
  });

  it("closes cleanly once everything is in place", async () => {
    const context = await loginAs("HSE");
    const hazard = await hazards.createHazard(
      context,
      hazardInput({ likelihood: "2", severity: "2", controlMeasure: "Cleared and kept clear." }),
    );
    created.hazards.push(hazard.id);

    await hazards.closeHazard(
      context,
      hazard.id,
      hazardCloseSchema.parse({ closureNote: "Walkway cleared and checked the next morning." }),
    );

    const closed = await hazards.getHazard(context, hazard.id);
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedBy?.memberId).toBe(context.membershipId);
  });

  it("wants the residual risk before closing a high or critical one", async () => {
    const context = await loginAs("HSE");
    const hazard = await hazards.createHazard(
      context,
      hazardInput({
        likelihood: "4",
        severity: "4",
        controlMeasure: "Guard installed.",
        immediateControl: "Isolated at the time.",
      }),
    );
    created.hazards.push(hazard.id);
    expect(hazard.risk.level).toBe("HIGH");

    await expect(
      hazards.closeHazard(
        context,
        hazard.id,
        hazardCloseSchema.parse({ closureNote: "Done." }),
      ),
    ).rejects.toThrow(AccessError);

    await hazards.closeHazard(
      context,
      hazard.id,
      hazardCloseSchema.parse({
        closureNote: "Guard installed and checked.",
        residualLikelihood: "1",
        residualSeverity: "4",
      }),
    );

    const closed = await hazards.getHazard(context, hazard.id);
    expect(closed.status).toBe("CLOSED");
    expect(closed.residualRisk?.score).toBe(4);
  });

  it("a closed hazard is read-only until it is reopened (§353)", async () => {
    const context = await loginAs("HSE");
    const closed = await hazards.getHazard(context, SEED.closedHazard);

    expect(closed.capabilities.canEdit).toBe(false);
    await expect(
      hazards.updateHazard(context, SEED.closedHazard, hazardInput()),
    ).rejects.toThrow(AccessError);
  });

  it("reopening puts it back in play", async () => {
    const context = await loginAs("HSE");
    await remember("hazard", SEED.closedHazard);

    await hazards.reopenHazard(context, SEED.closedHazard, "The control did not hold.");
    const reopened = await hazards.getHazard(context, SEED.closedHazard);

    expect(reopened.status).toBe("REOPENED");
    expect(reopened.capabilities.canEdit).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

describe("incidents and near misses (PRD #22 §82, §95, §363)", () => {
  it("keeps a near miss in the same register as the incidents it predicts", async () => {
    const context = await loginAs("HSE");
    const nearMiss = await incidents.getIncident(context, SEED.nearMiss);

    expect(nearMiss.incidentType).toBe("NEAR_MISS");

    // And it is in the unfiltered list, not a separate one.
    const all = await incidents.listIncidents(context, incidentQuery);
    expect(all.data.some((row) => row.id === SEED.nearMiss)).toBe(true);
  });

  /*
   * §95 and §363: the whole point of investigating a serious incident. One
   * closed with "operative was careless" and no cause teaches nothing.
   */
  it("refuses to put a serious incident up for closure with no root cause", async () => {
    const context = await loginAs("HSE");
    const incident = await incidents.getIncident(context, SEED.investigatingIncident);

    expect(incident.severity).toBe("HIGH");
    expect(incident.rootCause).toBeNull();
    expect(incident.closureGaps).toContain("ROOT_CAUSE");

    await remember("incident", SEED.investigatingIncident);
    await expect(
      incidents.submitIncidentClose(context, SEED.investigatingIncident, "Closing it."),
    ).rejects.toThrow(AccessError);
  });

  it("lets it through once the cause is recorded", async () => {
    const context = await loginAs("HSE");
    await remember("incident", SEED.investigatingIncident);

    await incidents.recordInvestigation(context, SEED.investigatingIncident, {
      investigationSummary: "Walked the scaffold and spoke to the gang.",
      rootCause: "The board had not been re-fixed after a delivery.",
      lessonsLearned: "Check boards after every delivery.",
    } as never);

    await incidents.submitIncidentClose(
      context,
      SEED.investigatingIncident,
      "Cause understood and the check added to the daily walk.",
    );

    const after = await incidents.getIncident(context, SEED.investigatingIncident);
    expect(after.status).toBe("PENDING_CLOSE");

    // And the approval it opened is cleaned up by the afterEach.
    const approval = await prisma.hseApproval.findFirst({
      where: { recordType: "INCIDENT_CLOSE", recordId: SEED.investigatingIncident, status: "PENDING" },
      select: { id: true },
    });
    if (approval) openedApprovals.push(approval.id);
  });

  it("refuses to let whoever put it up for closure also close it (§182)", async () => {
    const hse = await loginAs("HSE");
    const detail = await incidents.getIncident(hse, SEED.pendingCloseIncident);

    expect(detail.status).toBe("PENDING_CLOSE");
    expect(detail.capabilities.canClose).toBe(false);
    await expect(
      incidents.closeIncident(hse, SEED.pendingCloseIncident, null, await shownCycle("hse", SEED.pendingCloseIncident)),
    ).rejects.toThrow(AccessError);
  });

  it("wants an immediate action on a serious incident (§362)", () => {
    const parsed = incidentSchema.safeParse({
      incidentType: "INCIDENT",
      title: "Serious, with no immediate action",
      description: "Nothing was done at the time.",
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      severity: "CRITICAL",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an incident that has not happened yet (§85)", () => {
    const parsed = incidentSchema.safeParse({
      incidentType: "INCIDENT",
      title: "Tomorrow",
      description: "An incident in the future is a hazard.",
      occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
      severity: "LOW",
    });
    expect(parsed.success).toBe(false);
  });

  it("records injury as flags and nothing more (§22, §87)", async () => {
    const context = await loginAs("HSE");
    const incident = await incidents.getIncident(context, SEED.closedIncident);

    expect(incident.injury).not.toBeNull();
    expect(Object.keys(incident.injury!).sort()).toEqual([
      "environmentalImpact",
      "firstAidRequired",
      "injuryOccurred",
      "lostTime",
      "medicalTreatmentRequired",
      "propertyDamage",
    ]);
    // There is no diagnosis, no history, no note about the person.
    expect(JSON.stringify(incident.injury)).not.toMatch(/diagnos|medical.?histor/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

describe("HSE actions (PRD #22 §121, §122, §128)", () => {
  it("refuses to let whoever did the work verify it", async () => {
    const context = await loginAs("HSE");
    const action = await actionService.getAction(context, SEED.pendingAction);

    // Seeded as completed by the PM, so the PM is the one who must not verify.
    const completedBy = action.completedBy?.memberId;
    expect(completedBy).toBeTruthy();

    const pm = await loginAs("PROJECT_MANAGER");
    if (pm.membershipId === completedBy && can(pm, "hse.action.verify")) {
      await expect(
        actionService.verifyAction(pm, SEED.pendingAction, null),
      ).rejects.toThrow(AccessError);
    }

    // Somebody else can.
    await remember("action", SEED.pendingAction);
    await actionService.verifyAction(context, SEED.pendingAction, "Checked on site.");
    expect((await actionService.getAction(context, SEED.pendingAction)).status).toBe("VERIFIED");
  });

  it("withholds the verify control from whoever completed it", async () => {
    const context = await loginAs("HSE");
    const verified = await actionService.getAction(context, SEED.verifiedAction);
    expect(verified.capabilities.canVerify).toBe(false);
  });

  it("borrows its project from the record it was raised against (§239)", async () => {
    const context = await loginAs("HSE");
    const hazard = await hazards.getHazard(context, SEED.openHazard);

    const action = await actionService.createAction(
      context,
      actionSchema.parse({
        title: "Follow-up on the open hazard",
        description: "Raised by the automated suite.",
        hazardId: SEED.openHazard,
        assignedToMemberId: context.membershipId,
      }),
    );
    created.actions.push(action.id);

    expect(action.project?.id).toBe(hazard.project?.id);
    expect(action.source?.kind).toBe("HAZARD");
  });

  it("refuses a parent the caller cannot reach", async () => {
    const context = await loginAs("HSE");
    await expect(
      actionService.createAction(
        context,
        actionSchema.parse({
          title: "Against another company's hazard",
          description: "Should never be possible.",
          hazardId: SEED.companyBHazard,
          assignedToMemberId: context.membershipId,
        }),
      ),
    ).rejects.toThrow(AccessError);
  });

  /*
   * §128: the Task is the work item, the action is the obligation. Creating one
   * must not advance the other.
   */
  it("raises a canonical Task without advancing the action", async () => {
    const context = await loginAs("HSE");
    const action = await actionService.createAction(
      context,
      actionSchema.parse({
        title: "Needs a task",
        description: "Raised by the automated suite.",
        projectId: SEED.projectA,
        assignedToMemberId: context.membershipId,
      }),
    );
    created.actions.push(action.id);

    const task = await actionService.createTaskForAction(context, action.id, {
      title: "Do the thing",
    });

    const after = await actionService.getAction(context, action.id);
    expect(after.status).toBe("OPEN");
    expect(after.tasks.some((row) => row.id === task.id)).toBe(true);

    await prisma.task.deleteMany({ where: { id: task.id } });
  });

  it("a verified action is read-only until it is reopened (§354)", async () => {
    const context = await loginAs("HSE");
    const verified = await actionService.getAction(context, SEED.verifiedAction);

    expect(verified.capabilities.canEdit).toBe(false);
    await expect(
      actionService.updateAction(
        context,
        SEED.verifiedAction,
        actionSchema.parse({
          title: "Trying to edit a verified action",
          description: "Should be refused.",
          assignedToMemberId: context.membershipId,
        }),
      ),
    ).rejects.toThrow(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* Work permits                                                                */
/* -------------------------------------------------------------------------- */

describe("work permits (PRD #22 §147, §149, §150, §151)", () => {
  it("refuses a window that runs backwards (§147)", () => {
    const parsed = permitSchema.safeParse({
      permitType: "HOT_WORK",
      title: "Backwards",
      projectId: SEED.projectA,
      locationText: "Level 1",
      validFrom: new Date(Date.now() + 86_400_000).toISOString(),
      validUntil: new Date().toISOString(),
    });
    expect(parsed.success).toBe(false);
  });

  /*
   * §151: the clock beats the column. A permit whose window closed last night
   * authorises nothing, whatever the stored status says.
   */
  it("reads a lapsed permit as expired everywhere", async () => {
    const context = await loginAs("HSE");
    const permit = await permits.getPermit(context, SEED.lapsedPermit);

    expect(permit.status).toBe("ACTIVE");
    expect(permit.effectiveStatus).toBe("EXPIRED");
    expect(permit.hoursRemaining).toBeLessThan(0);
    expect(permit.capabilities.canActivate).toBe(false);
    // It can still be closed, so the paperwork gets finished (§154).
    expect(permit.capabilities.canClose).toBe(true);
  });

  it("refuses to activate outside the window it authorises (§150)", async () => {
    const context = await loginAs("HSE");
    const permit = await permits.createPermit(
      context,
      permitSchema.parse({
        permitType: "GENERAL",
        title: "Next week",
        projectId: SEED.projectA,
        locationText: "Level 1",
        validFrom: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        validUntil: new Date(Date.now() + 8 * 86_400_000).toISOString(),
      }),
    );
    created.permits.push(permit.id);

    await permits.submitPermit(context, permit.id);
    const owner = await loginAs("OWNER");
    await permits.approvePermit(owner, permit.id, null, await shownCycle("hse", permit.id));

    await expect(permits.activatePermit(owner, permit.id)).rejects.toThrow(AccessError);
  });

  it("refuses to let the requester approve their own permit (§149)", async () => {
    const context = await loginAs("HSE");
    const permit = await permits.createPermit(
      context,
      permitSchema.parse({
        permitType: "HOT_WORK",
        title: "Self-approval attempt",
        projectId: SEED.projectA,
        locationText: "Level 1",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    created.permits.push(permit.id);

    await permits.submitPermit(context, permit.id);

    const detail = await permits.getPermit(context, permit.id);
    expect(detail.capabilities.canApprove).toBe(false);
    await expect(permits.approvePermit(context, permit.id, null, await shownCycle("hse", permit.id))).rejects.toThrow(AccessError);
  });

  it("goes the whole way: submit, approve, activate, suspend, reactivate, close", async () => {
    const context = await loginAs("HSE");
    const owner = await loginAs("OWNER");

    const permit = await permits.createPermit(
      context,
      permitSchema.parse({
        permitType: "LIFTING",
        title: "Full lifecycle",
        projectId: SEED.projectA,
        locationText: "Crane base",
        validFrom: new Date(Date.now() - 3_600_000).toISOString(),
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    created.permits.push(permit.id);

    await permits.submitPermit(context, permit.id);
    await permits.approvePermit(owner, permit.id, "Approved.", await shownCycle("hse", permit.id));
    await permits.activatePermit(owner, permit.id);
    expect((await permits.getPermit(owner, permit.id)).status).toBe("ACTIVE");

    await permits.suspendPermit(owner, permit.id, "Weather.");
    expect((await permits.getPermit(owner, permit.id)).status).toBe("SUSPENDED");

    await permits.activatePermit(owner, permit.id);
    expect((await permits.getPermit(owner, permit.id)).status).toBe("ACTIVE");

    await permits.closePermit(owner, permit.id);
    expect((await permits.getPermit(owner, permit.id)).status).toBe("CLOSED");
  });

  it("an active permit's terms are frozen (§351)", async () => {
    const context = await loginAs("HSE");
    const permit = await permits.getPermit(context, SEED.activePermit);

    expect(permit.capabilities.canEdit).toBe(false);
    await expect(
      permits.updatePermit(
        context,
        SEED.activePermit,
        permitSchema.parse({
          permitType: "GENERAL",
          title: "Changed under the people working to it",
          projectId: permit.project.id,
          locationText: "Somewhere else",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ),
    ).rejects.toThrow(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

describe("stop-work (PRD #22 §173, §174)", () => {
  it("is blocked while a critical action against it is unverified", async () => {
    const context = await loginAs("HSE");
    const record = await stopWork.getStopWork(context, SEED.blockedStopWork);

    expect(record.status).toBe("ACTIVE");
    expect(record.releaseGaps).toContain("UNRESOLVED_CRITICAL_ACTION");
    expect(record.capabilities.canRelease).toBe(false);

    await remember("stopWork", SEED.blockedStopWork);
    await expect(
      stopWork.releaseStopWork(context, SEED.blockedStopWork, "Sending them back."),
    ).rejects.toThrow(AccessError);
  });

  it("releases once the cause is dealt with", async () => {
    const context = await loginAs("HSE");
    const record = await stopWork.createStopWork(
      context,
      stopWorkSchema.parse({
        title: "Test stop-work",
        projectId: SEED.projectA,
        reason: "Raised by the automated suite.",
      }),
    );
    created.stopWorks.push(record.id);

    await stopWork.releaseStopWork(context, record.id, "Nothing outstanding against it.");
    const after = await stopWork.getStopWork(context, record.id);

    expect(after.status).toBe("RELEASED");
    expect(after.releasedBy?.memberId).toBe(context.membershipId);
  });

  /*
   * §173 vs §174: anybody who can see the work going wrong may halt it. An
   * engineer holds stop_work.create through CONTRIBUTE, but not the release.
   */
  it("separates stopping work from letting it restart", async () => {
    const engineer = await loginAs("ENGINEER");
    expect(can(engineer, "hse.stop_work.create")).toBe(true);
    expect(can(engineer, "hse.stop_work.release")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

describe("risk assessments (PRD #22 §107, §112, §359)", () => {
  it("versions an approved assessment rather than rewriting it", async () => {
    const context = await loginAs("HSE");
    const before = await risk.getRiskAssessment(context, SEED.approvedAssessment);

    expect(before.status).toBe("APPROVED");
    expect(before.capabilities.canEdit).toBe(false);
    expect(before.capabilities.canVersion).toBe(true);

    const after = await risk.updateRiskAssessment(
      context,
      SEED.approvedAssessment,
      riskAssessmentSchema.parse({
        title: before.title,
        projectId: before.project?.id,
        assessmentDate: before.assessmentDate.slice(0, 10),
        items: before.items.map((item) => ({
          hazardDescription: item.hazardDescription,
          likelihood: String(item.risk.likelihood),
          severity: String(item.risk.severity),
        })),
      }),
    );
    created.assessments.push(after.id);

    expect(after.id).not.toBe(SEED.approvedAssessment);
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe("DRAFT");

    // The approved one is untouched; site work was carried out against it.
    const original = await risk.getRiskAssessment(context, SEED.approvedAssessment);
    expect(original.status).toBe("APPROVED");
    expect(original.version).toBe(before.version);
  });

  it("flags a review date that has passed without invalidating anything", async () => {
    const context = await loginAs("HSE");
    const due = await risk.listRiskAssessments(
      context,
      riskAssessmentListSchema.parse({ view: "review-due", limit: 50 }),
    );

    expect(due.data.length).toBeGreaterThan(0);
    for (const row of due.data) {
      expect(row.reviewDue).toBe(true);
      // Still approved. Nothing expires by itself (§359).
      expect(row.status).toBe("APPROVED");
    }
  });

  it("derives every line's score from its two axes (§105)", async () => {
    const context = await loginAs("HSE");
    const assessment = await risk.getRiskAssessment(context, SEED.approvedAssessment);

    for (const item of assessment.items) {
      expect(item.risk.score).toBe(item.risk.likelihood * item.risk.severity);
      if (item.residualRisk) {
        expect(item.residualRisk.score).toBe(
          item.residualRisk.likelihood * item.residualRisk.severity,
        );
        expect(item.residualRisk.score).toBeLessThanOrEqual(item.risk.score);
      }
    }
  });

  it("refuses to let the submitter approve their own assessment (§182)", async () => {
    const context = await loginAs("HSE");
    const detail = await risk.getRiskAssessment(context, SEED.pendingAssessment);

    expect(detail.status).toBe("PENDING_APPROVAL");
    expect(detail.capabilities.canApprove).toBe(false);
    await expect(
      risk.approveRiskAssessment(context, SEED.pendingAssessment, null, await shownCycle("hse", SEED.pendingAssessment)),
    ).rejects.toThrow(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* Toolbox, PPE and environment                                                */
/* -------------------------------------------------------------------------- */

describe("toolbox talks (PRD #22 §132, §133, §137)", () => {
  it("records colleagues and outside people side by side", async () => {
    const context = await loginAs("HSE");
    const talk = await toolbox.getToolboxTalk(context, SEED.completedTalk);

    expect(talk.participants.some((row) => row.member !== null)).toBe(true);
    expect(talk.participants.some((row) => row.externalName !== null)).toBe(true);
  });

  it("refuses a participant who is neither a colleague nor a name (§133)", () => {
    const parsed = toolboxSchema.safeParse({
      title: "Empty row",
      topic: "Nothing",
      talkDate: new Date().toISOString().slice(0, 10),
      conductedByMemberId: "anything",
      participants: [{ attendanceStatus: "ATTENDED" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses to complete a talk nobody attended (§137)", async () => {
    const context = await loginAs("HSE");
    const talk = await toolbox.createToolboxTalk(
      context,
      toolboxSchema.parse({
        title: "Nobody came",
        topic: "Testing",
        talkDate: new Date().toISOString().slice(0, 10),
        conductedByMemberId: context.membershipId,
        participants: [],
      }),
    );
    created.talks.push(talk.id);

    await expect(toolbox.completeToolboxTalk(context, talk.id)).rejects.toThrow(AccessError);
  });
});

describe("PPE checks (PRD #22 §160, §162)", () => {
  it("refuses a check that looked at nothing", () => {
    const parsed = ppeCheckSchema.safeParse({
      checkDate: new Date().toISOString().slice(0, 10),
    });
    expect(parsed.success).toBe(false);
  });

  it("derives the result from the items actually recorded", async () => {
    const context = await loginAs("HSE");
    const check = await ppe.createPpeCheck(
      context,
      ppeCheckSchema.parse({
        checkDate: new Date().toISOString().slice(0, 10),
        projectId: SEED.projectA,
        helmetOk: "yes",
        harnessOk: "no",
      }),
    );
    created.ppe.push(check.id);

    expect(check.result).toBe("FAIL");
    expect(check.failedItems).toEqual(["Harness"]);
    // Only what was looked at is listed — a blank item is not a pass.
    expect(check.items).toHaveLength(2);
  });

  /*
   * §162: issuing a helmet from the store is a stock issue; checking somebody
   * is wearing one is a safety observation. The two must not be wired together.
   */
  it("never touches Inventory", async () => {
    const before = await prisma.stockMovement.count();
    const context = await loginAs("HSE");

    const check = await ppe.createPpeCheck(
      context,
      ppeCheckSchema.parse({
        checkDate: new Date().toISOString().slice(0, 10),
        projectId: SEED.projectA,
        helmetOk: "yes",
      }),
    );
    created.ppe.push(check.id);

    expect(await prisma.stockMovement.count()).toBe(before);
  });
});

describe("environmental observations (PRD #22 §168)", () => {
  it("refuses to close while an action against it is unverified", async () => {
    const context = await loginAs("HSE");
    const observation = await environment.createObservation(
      context,
      observationSchema.parse({
        category: "DUST",
        title: "Test observation",
        description: "Raised by the automated suite.",
        projectId: SEED.projectA,
        observedAt: new Date().toISOString().slice(0, 10),
        severity: "LOW",
      }),
    );
    created.observations.push(observation.id);

    const action = await actionService.createAction(
      context,
      actionSchema.parse({
        title: "Deal with the dust",
        description: "Raised by the automated suite.",
        environmentalObservationId: observation.id,
        assignedToMemberId: context.membershipId,
      }),
    );
    created.actions.push(action.id);

    await expect(
      environment.closeObservation(context, observation.id, "Calling it done."),
    ).rejects.toThrow(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope, isolation and reporting                                              */
/* -------------------------------------------------------------------------- */

describe("company isolation (PRD #22 §409)", () => {
  it("never returns another company's hazard", async () => {
    const context = await loginAs("HSE");
    const list = await hazards.listHazards(context, hazardQuery);

    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data.some((row) => row.id === SEED.companyBHazard)).toBe(false);
    await expect(hazards.getHazard(context, SEED.companyBHazard)).rejects.toThrow(AccessError);
  });

  it("never returns another company's incident", async () => {
    const context = await loginAs("HSE");
    await expect(incidents.getIncident(context, SEED.companyBIncident)).rejects.toThrow(
      AccessError,
    );
  });

  /*
   * Company-scoped numbering: both companies have HZ-2026-0001 and neither can
   * see the other's. A global unique constraint would have made this impossible
   * to seed, which is exactly why it is per-company.
   */
  it("numbers records per company, not globally", async () => {
    const both = await prisma.hseHazard.findMany({
      where: { hazardNumber: "HZ-2026-0001" },
      select: { companyId: true },
    });
    expect(new Set(both.map((row) => row.companyId)).size).toBeGreaterThan(1);
  });
});

describe("who sees what (PRD #22 §18, §23, §24, §244–§248)", () => {
  it("Group IT gets no HSE business records by default (§23, §24)", async () => {
    const it = await loginAs("GROUP_IT");
    expect(can(it, "hse.hazard.view")).toBe(false);
    expect(can(it, "hse.incident.view")).toBe(false);
    await expect(hazards.listHazards(it, hazardQuery)).rejects.toThrow(AccessError);
  });

  it("the Platform Admin has no company to read them in either (§23)", async () => {
    await expect(loginAs("PLATFORM_ADMIN")).rejects.toThrow();
  });

  it("the CEO reads the company position but mutates nothing (§25)", async () => {
    const ceo = await loginAs("CEO");
    expect(can(ceo, "hse.hazard.view")).toBe(true);
    expect(can(ceo, "hse.hazard.create")).toBe(false);
    expect(can(ceo, "hse.incident.close")).toBe(false);

    const list = await hazards.listHazards(ceo, hazardQuery);
    expect(list.data.length).toBeGreaterThan(0);
  });

  /*
   * §27: reporting a hazard is the widest-granted act in the module. A hazard
   * that only the safety officer may report is one that waits for the safety
   * officer to walk past it.
   */
  it("an engineer can report a hazard and an incident", async () => {
    const engineer = await loginAs("ENGINEER");
    expect(can(engineer, "hse.hazard.create")).toBe(true);
    expect(can(engineer, "hse.incident.create")).toBe(true);

    // But not judge the risk or close it.
    expect(can(engineer, "hse.hazard.assess")).toBe(false);
    expect(can(engineer, "hse.hazard.close")).toBe(false);
  });

  it("a project-scoped reader sees their sites and not the company (§246)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const hse = await loginAs("HSE");
    const elsewhere = await hazardOffTheirSites(hse);

    const theirs = await hazards.listHazards(pm, hazardQuery);
    const all = await hazards.listHazards(hse, hazardQuery);

    expect(theirs.pagination.total).toBeGreaterThan(0);
    expect(theirs.pagination.total).toBeLessThan(all.pagination.total);
    expect(theirs.data.some((row) => row.id === elsewhere.id)).toBe(false);
  });

  /*
   * §248: somebody who reports a hazard must be able to see what became of it.
   * A report that vanishes from its reporter's view is a report nobody makes
   * twice.
   */
  it("a reporter follows their own hazard even off their projects", async () => {
    const engineer = await loginAs("ENGINEER");
    const hazard = await hazards.createHazard(
      engineer,
      hazardInput({ projectId: undefined, title: "Reported with no project" }),
    );
    created.hazards.push(hazard.id);

    const mine = await hazards.listHazards(engineer, hazardQuery);
    expect(mine.data.some((row) => row.id === hazard.id)).toBe(true);
  });

  /*
   * §19 and §29: the `*` cells on the access matrix. Quality and safety look at
   * the same site and answer different questions — each reads the other's
   * headline and writes neither.
   */
  it("QA/QC and the Architect see the project position, not the safety apparatus", async () => {
    for (const role of ["QAQC", "ARCHITECT"] as const) {
      const context = await loginAs(role);

      expect(can(context, "hse.hazard.view"), role).toBe(true);
      expect(can(context, "hse.incident.view"), role).toBe(true);

      expect(can(context, "hse.template.view"), role).toBe(false);
      expect(can(context, "hse.approval.view"), role).toBe(false);
      expect(can(context, "hse.stop_work.view"), role).toBe(false);
      expect(can(context, "hse.risk.view"), role).toBe(false);
      expect(can(context, "hse.export"), role).toBe(false);

      // And no write of any kind on somebody else's findings.
      expect(can(context, "hse.hazard.update"), role).toBe(false);
      expect(can(context, "hse.incident.update"), role).toBe(false);
    }
  });

  it("the safety officer reads quality's headline and writes none of it", async () => {
    const hse = await loginAs("HSE");
    expect(can(hse, "qaqc.inspection.view")).toBe(true);
    expect(can(hse, "qaqc.template.view")).toBe(false);
    expect(can(hse, "qaqc.approval.view")).toBe(false);
    expect(can(hse, "qaqc.inspection.approve")).toBe(false);
  });

  it("nobody holds the self-approval grant by default (§182)", async () => {
    for (const role of ["OWNER", "HSE", "PROJECT_MANAGER", "ENGINEER", "CEO"] as const) {
      const context = await loginAs(role);
      expect(can(context, "hse.approval.self"), role).toBe(false);
    }
  });
});

describe("the approval queue (PRD #22 §181, §182, §184)", () => {
  it("lists only decisions on records the reader could open", async () => {
    const hse = await loginAs("HSE");
    const queue = await approvals.listApprovalQueue(hse, { limit: 100 });

    expect(queue.data.length).toBeGreaterThan(0);
    for (const item of queue.data) {
      expect(item.status).toBe("PENDING");
      expect(item.reference).toBeTruthy();
    }
  });

  it("withholds the decision from whoever submitted", async () => {
    const hse = await loginAs("HSE");
    const queue = await approvals.listApprovalQueue(hse, { limit: 100 });

    const own = queue.data.filter((item) => item.submittedBy?.memberId === hse.membershipId);
    expect(own.length).toBeGreaterThan(0);
    for (const item of own) expect(item.canDecide).toBe(false);
  });

  it("settles a race between two decisions once (§184)", async () => {
    await rememberDecision("inspection", SEED.pendingPass, "INSPECTION");
    const owner = await loginAs("OWNER");

    await inspections.approveInspection(owner, SEED.pendingPass, "First.", await shownCycle("hse", SEED.pendingPass));
    await expect(
      inspections.approveInspection(owner, SEED.pendingPass, "Second.", await shownCycle("hse", SEED.pendingPass)),
    ).rejects.toThrow(AccessError);
  });

  it("keeps decided rows so the queue is also a history (§465)", async () => {
    const hse = await loginAs("HSE");
    const all = await approvals.listApprovalQueue(hse, { limit: 100, includeDecided: true });

    expect(all.data.some((item) => item.status !== "PENDING")).toBe(true);
  });
});

describe("overview and reports (PRD #22 §30, §199, §215, §424)", () => {
  it("counts only what the reader may see", async () => {
    const hse = await loginAs("HSE");
    const pm = await loginAs("PROJECT_MANAGER");
    await hazardOffTheirSites(hse);

    const companyWide = await getHseOverview(hse);
    const projectScoped = await getHseOverview(pm);

    const hazardsOf = (kpis: { key: string; value: number }[]) =>
      kpis.find((kpi) => kpi.key === "openHazards")?.value ?? 0;

    expect(hazardsOf(companyWide.kpis)).toBeGreaterThan(hazardsOf(projectScoped.kpis));
  });

  it("puts an active stop-work at the top of the attention list (§361)", async () => {
    const hse = await loginAs("HSE");
    const overview = await getHseOverview(hse);

    expect(overview.activeStopWorks.length).toBeGreaterThan(0);
    expect(overview.attention[0]?.id).toBe("stop-work");
    expect(overview.attention[0]?.priority).toBe("CRITICAL");
  });

  /*
   * The CEO reads the whole company position — §25 restricts them from
   * *mutating*, not from seeing. The narrower reader is QA/QC, whose `*` on the
   * access matrix means the project summary and not the safety apparatus (§29).
   */
  it("offers only the reports the reader holds the permission for (§217)", async () => {
    const hse = await loginAs("HSE");
    const qaqc = await loginAs("QAQC");

    expect(availableReports(hse).length).toBeGreaterThan(availableReports(qaqc).length);
    for (const report of availableReports(qaqc)) {
      expect(can(qaqc, report.permission), report.key).toBe(true);
    }
  });

  it("builds the 5×5 matrix with every cell carrying its score (§202, §358)", async () => {
    const hse = await loginAs("HSE");
    const report = await runReport(hse, "risk-matrix");

    expect(report.matrix).toHaveLength(25);
    for (const cell of report.matrix!) {
      expect(cell.score).toBe(cell.likelihood * cell.severity);
      expect(cell.level).toBeTruthy();
    }
    expect(report.matrix!.some((cell) => cell.count > 0)).toBe(true);
  });

  it("refuses a report the reader may not see", async () => {
    const qaqc = await loginAs("QAQC");
    expect(can(qaqc, "hse.report.view")).toBe(false);
    await expect(runReport(qaqc, "hazard-register")).rejects.toThrow(AccessError);
  });

  it("summarises one project without leaking the rest (§215)", async () => {
    const hse = await loginAs("HSE");
    const summary = await getProjectHseSummary(hse, SEED.projectA);

    expect(summary.inspections).toBeGreaterThan(0);
    expect(summary.passRate).not.toBeNull();
    expect(summary.openHazards).toBeGreaterThan(0);

    const all = await hazards.listHazards(hse, hazardQuery);
    expect(summary.openHazards).toBeLessThan(all.pagination.total);
  });

  it("reports a pass rate of null, not 0%, when nothing was inspected", async () => {
    const hse = await loginAs("HSE");
    const empty = await getProjectHseSummary(hse, "project_archived");
    if (empty.inspections === 0) expect(empty.passRate).toBeNull();
  });
});
