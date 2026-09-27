import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import * as approvals from "@/lib/modules/hse/approvals/approval.service";
import { loadMembers } from "@/lib/modules/hse/hse.dto";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import { getHseOverview } from "@/lib/modules/hse/overview/overview.service";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import * as ppe from "@/lib/modules/hse/ppe/ppe.service";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import * as stopWork from "@/lib/modules/hse/stop-work/stop-work.service";
import {
  actionSchema,
  hazardCloseSchema,
  hazardSchema,
  incidentSchema,
  permitSchema,
  ppeCheckSchema,
  riskAssessmentSchema,
  stopWorkSchema,
} from "@/lib/modules/hse/hse.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { shownCycle } from "../approvals/aud10-cycles";

/**
 * HSE authorisation and company isolation (PRD #47 §20, §51, §62, §85).
 *
 * Every body field that names another record is a claim. These tests submit
 * the claims a hostile or careless client could make — another company's
 * incident, another site's risk assessment, a colleague who does not work
 * here — and confirm the service checks them before writing anything.
 */

const COMPANY_A = "company_demo_a";
const COMPANY_B = "company_fixture_tenant";

const SEED = {
  projectA: "project_a",
  openHazardA: "hse_hz_002",
  draftAssessmentA: "hse_ra_010",
  pendingCloseIncident: "hse_inc_009",
  companyBIncident: "hse_inc_b_001",
  companyBMember: "member_owner_b",
  pmMember: "member_pm",
} as const;

/**
 * A second site in Company A, with a hazard, an inspection and an approved risk
 * assessment on it. Each demo company has one project (E-06 §49), so another
 * project's record has to be made.
 */
const OTHER_SITE = {
  project: "hseauthz_other_site",
  hazard: "hseauthz_other_hazard",
  inspection: "hseauthz_other_inspection",
  assessment: "hseauthz_other_assessment",
} as const;

async function removeOtherSite() {
  await prisma.hseHazard.deleteMany({ where: { id: OTHER_SITE.hazard } });
  await prisma.hseInspection.deleteMany({ where: { id: OTHER_SITE.inspection } });
  await prisma.hseRiskAssessment.deleteMany({ where: { id: OTHER_SITE.assessment } });
  await prisma.project.deleteMany({ where: { id: OTHER_SITE.project } });
}

beforeAll(async () => {
  await removeOtherSite();
  const officer = "member_hse";
  await prisma.project.create({
    data: { id: OTHER_SITE.project, companyId: COMPANY_A, code: "HSEAUTHZ-OTHER", name: "Authorisation test site", status: "ACTIVE", createdBy: "test" },
  });
  await prisma.hseRiskAssessment.create({
    data: {
      id: OTHER_SITE.assessment,
      companyId: COMPANY_A,
      projectId: OTHER_SITE.project,
      assessmentNumber: "RA-AUTHZ-0001",
      title: "Excavation on the other site",
      assessmentDate: new Date(),
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByMemberId: "member_owner",
      createdByMemberId: officer,
    },
  });
  await prisma.hseInspection.create({
    data: {
      id: OTHER_SITE.inspection,
      companyId: COMPANY_A,
      projectId: OTHER_SITE.project,
      inspectionNumber: "INS-AUTHZ-0001",
      inspectionType: "EXCAVATION",
      status: "APPROVED",
      result: "PASS",
      assignedInspectorMemberId: officer,
      createdByMemberId: officer,
    },
  });
  await prisma.hseHazard.create({
    data: {
      id: OTHER_SITE.hazard,
      companyId: COMPANY_A,
      projectId: OTHER_SITE.project,
      hazardNumber: "HZ-AUTHZ-0001",
      title: "Open excavation edge",
      description: "On the other site.",
      hazardCategory: "EXCAVATION",
      likelihood: 4,
      severityScore: 5,
      riskScore: 20,
      riskLevel: "CRITICAL",
      observedAt: new Date(),
      reportedByMemberId: officer,
      createdByMemberId: officer,
    },
  });
});

const created = {
  actions: [] as string[],
  hazards: [] as string[],
  permits: [] as string[],
  ppe: [] as string[],
  assessments: [] as string[],
  stopWorks: [] as string[],
};

afterEach(async () => {
  const ids = Object.values(created).flat();
  if (ids.length > 0) await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });

  if (created.actions.length > 0) {
    await prisma.hseAction.deleteMany({ where: { id: { in: created.actions } } });
  }
  if (created.stopWorks.length > 0) {
    await prisma.stopWorkRecord.deleteMany({ where: { id: { in: created.stopWorks } } });
  }
  if (created.hazards.length > 0) {
    await prisma.hseAction.deleteMany({ where: { hazardId: { in: created.hazards } } });
    await prisma.hseHazard.deleteMany({ where: { id: { in: created.hazards } } });
  }
  if (created.permits.length > 0) {
    await prisma.hseApproval.deleteMany({ where: { recordId: { in: created.permits } } });
    await prisma.hseWorkPermit.deleteMany({ where: { id: { in: created.permits } } });
  }
  if (created.ppe.length > 0) {
    await prisma.ppeCheck.deleteMany({ where: { id: { in: created.ppe } } });
  }
  if (created.assessments.length > 0) {
    await prisma.hseRiskAssessmentItem.deleteMany({
      where: { riskAssessmentId: { in: created.assessments } },
    });
    await prisma.hseRiskAssessment.deleteMany({ where: { id: { in: created.assessments } } });
  }

  for (const list of Object.values(created)) list.length = 0;
});

afterAll(async () => {
  await removeOtherSite();
  await cleanupSessions();
  await prisma.$disconnect();
});

const today = () => new Date().toISOString().slice(0, 10);

function hazardInput(overrides: Record<string, unknown> = {}) {
  return hazardSchema.parse({
    title: "Authorisation test hazard",
    description: "Raised by the authorisation suite.",
    projectId: SEED.projectA,
    hazardCategory: "HOUSEKEEPING",
    likelihood: "2",
    severity: "2",
    observedAt: today(),
    ...overrides,
  });
}

function permitInput(overrides: Record<string, unknown> = {}) {
  return permitSchema.parse({
    permitType: "GENERAL",
    title: "Authorisation test permit",
    projectId: SEED.projectA,
    locationText: "Level 1",
    validFrom: new Date(Date.now() + 86_400_000).toISOString(),
    validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    ...overrides,
  });
}

/** The reason a refused link carries, for the security log (PRD #47 §118). */
async function refusal(promise: Promise<unknown>): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessError);
  return error as AccessError;
}

/* -------------------------------------------------------------------------- */
/* P0: action parents                                                          */
/* -------------------------------------------------------------------------- */

describe("an HSE action's parent (PRD #47 §20)", () => {
  it("refuses another company's incident and leaves that incident alone", async () => {
    const context = await loginAs("HSE");
    const before = await prisma.hseIncident.findUniqueOrThrow({
      where: { id: SEED.companyBIncident },
      select: { status: true },
    });

    const error = await refusal(
      actionService.createAction(
        context,
        actionSchema.parse({
          title: "Against another company's incident",
          description: "Should never be written.",
          incidentId: SEED.companyBIncident,
          assignedToMemberId: context.membershipId,
        }),
      ),
    );
    expect(error.code).toBe("VALIDATION_ERROR");

    const after = await prisma.hseIncident.findUniqueOrThrow({
      where: { id: SEED.companyBIncident },
      select: { status: true },
    });
    expect(after.status).toBe(before.status);
  });

  it("refuses a second parent smuggled in beside a legitimate one", async () => {
    const context = await loginAs("HSE");
    const planted = await prisma.hseAction.count({ where: { incidentId: SEED.companyBIncident } });

    const error = await refusal(
      actionService.createAction(
        context,
        actionSchema.parse({
          title: "Own hazard, foreign incident",
          description: "The incident id must not be written unchecked.",
          hazardId: SEED.openHazardA,
          incidentId: SEED.companyBIncident,
          assignedToMemberId: context.membershipId,
        }),
      ),
    );
    expect(error.code).toBe("VALIDATION_ERROR");

    expect(await prisma.hseAction.count({ where: { incidentId: SEED.companyBIncident } })).toBe(
      planted,
    );
    const incident = await prisma.hseIncident.findUniqueOrThrow({
      where: { id: SEED.companyBIncident },
      select: { status: true },
    });
    expect(incident.status).toBe("OPEN");
  });

  it("does not let another company's action hold a hazard open", async () => {
    const context = await loginAs("HSE");
    const hazard = await hazards.createHazard(
      context,
      hazardInput({ controlMeasure: "Cleared and kept clear." }),
    );
    created.hazards.push(hazard.id);

    // A row planted before link checks existed: Company B's action on A's hazard.
    const planted = await prisma.hseAction.create({
      data: {
        companyId: COMPANY_B,
        actionNumber: `AUTHZ-${Date.now()}`,
        actionType: "CORRECTIVE",
        title: "Planted",
        description: "Planted by the authorisation suite.",
        hazardId: hazard.id,
        assignedToMemberId: SEED.companyBMember,
        createdByMemberId: SEED.companyBMember,
        priority: "CRITICAL",
        status: "OPEN",
      },
      select: { id: true },
    });
    created.actions.push(planted.id);

    await hazards.closeHazard(
      context,
      hazard.id,
      hazardCloseSchema.parse({ closureNote: "Checked the next morning." }),
    );
    expect((await hazards.getHazard(context, hazard.id)).status).toBe("CLOSED");
  });

  it("refuses a project other than the parent's (PRD #47 §51)", async () => {
    const context = await loginAs("HSE");
    const error = await refusal(
      actionService.createAction(
        context,
        actionSchema.parse({
          title: "On the wrong site",
          description: "The hazard is on project A.",
          hazardId: SEED.openHazardA,
          projectId: OTHER_SITE.project,
          assignedToMemberId: context.membershipId,
        }),
      ),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.reason).toBe("CROSS_PROJECT_REFERENCE");
  });
});

/* -------------------------------------------------------------------------- */
/* P0: member ids and names                                                    */
/* -------------------------------------------------------------------------- */

describe("members named on safety records (PRD #47 §20, §62)", () => {
  it("refuses another company's member as a risk line's responsible person", async () => {
    const context = await loginAs("HSE");
    const error = await refusal(
      risk.createRiskAssessment(
        context,
        riskAssessmentSchema.parse({
          title: "Authorisation test assessment",
          projectId: SEED.projectA,
          assessmentDate: today(),
          items: [
            {
              hazardDescription: "Working at height",
              likelihood: "2",
              severity: "3",
              responsibleMemberId: SEED.companyBMember,
            },
          ],
        }),
      ),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toHaveProperty("items");
  });

  it("never prints another company's member name", async () => {
    const names = await loadMembers(COMPANY_A, [SEED.companyBMember, SEED.pmMember]);
    expect(names.has(SEED.companyBMember)).toBe(false);
    expect(names.has(SEED.pmMember)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* P1: counts                                                                  */
/* -------------------------------------------------------------------------- */

describe("overview counts (PRD #47 §62)", () => {
  it("counts the pending decisions the reader's queue would list, not the company's", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const overview = await getHseOverview(pm);
    const queue = await approvals.listApprovalQueue(pm, { limit: 1 });

    const card = overview.attention.find((item) => item.id === "pending-approvals");
    const shown = card ? Number.parseInt(card.title, 10) : 0;

    expect(shown).toBe(queue.pagination.total);
    expect(await approvals.countPendingApprovals(pm)).toBe(queue.pagination.total);
  });
});

/* -------------------------------------------------------------------------- */
/* P1: cross-project links                                                     */
/* -------------------------------------------------------------------------- */

describe("links between sites (PRD #47 §51)", () => {
  it("refuses a permit relying on another project's risk assessment", async () => {
    const context = await loginAs("HSE");
    const error = await refusal(
      permits.createPermit(context, permitInput({ riskAssessmentId: OTHER_SITE.assessment })),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.reason).toBe("CROSS_PROJECT_REFERENCE");
  });

  it("refuses a permit relying on a draft risk assessment", async () => {
    const context = await loginAs("HSE");
    const error = await refusal(
      permits.createPermit(context, permitInput({ riskAssessmentId: SEED.draftAssessmentA })),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses a stop-work caused by another project's hazard", async () => {
    const context = await loginAs("HSE");
    const error = await refusal(
      stopWork.createStopWork(
        context,
        stopWorkSchema.parse({
          title: "Wrong site",
          projectId: SEED.projectA,
          reason: "Raised by the authorisation suite.",
          hazardId: OTHER_SITE.hazard,
        }),
      ),
    );
    expect(error.reason).toBe("CROSS_PROJECT_REFERENCE");
  });

  it("refuses a hazard filed against another project's inspection", async () => {
    const context = await loginAs("HSE");
    const error = await refusal(
      hazards.createHazard(context, hazardInput({ inspectionId: OTHER_SITE.inspection })),
    );
    expect(error.reason).toBe("CROSS_PROJECT_REFERENCE");
  });
});

/* -------------------------------------------------------------------------- */
/* P1: who may change what                                                     */
/* -------------------------------------------------------------------------- */

describe("changes that need more than update (PRD #47 §85)", () => {
  it("the person a PPE check is about cannot re-post it as a pass", async () => {
    const hse = await loginAs("HSE");
    const check = await ppe.createPpeCheck(
      hse,
      ppeCheckSchema.parse({
        checkDate: today(),
        projectId: SEED.projectA,
        subjectMemberId: SEED.pmMember,
        harnessOk: "no",
      }),
    );
    created.ppe.push(check.id);
    expect(check.result).toBe("FAIL");

    const pm = await loginAs("PROJECT_MANAGER");
    const error = await refusal(
      ppe.updatePpeCheck(
        pm,
        check.id,
        ppeCheckSchema.parse({
          checkDate: today(),
          projectId: SEED.projectA,
          subjectMemberId: SEED.pmMember,
          harnessOk: "yes",
        }),
      ),
    );
    expect(error.code).toBe("FORBIDDEN");

    const row = await prisma.ppeCheck.findUniqueOrThrow({
      where: { id: check.id },
      select: { result: true },
    });
    expect(row.result).toBe("FAIL");
  });

  it("a contributor cannot lower a critical action", async () => {
    const hse = await loginAs("HSE");
    const action = await actionService.createAction(
      hse,
      actionSchema.parse({
        title: "Critical authorisation test action",
        description: "Holds a stop-work shut.",
        projectId: SEED.projectA,
        assignedToMemberId: SEED.pmMember,
        priority: "CRITICAL",
      }),
    );
    created.actions.push(action.id);

    const pm = await loginAs("PROJECT_MANAGER");
    const error = await refusal(
      actionService.updateAction(
        pm,
        action.id,
        actionSchema.parse({
          title: "Critical authorisation test action",
          description: "Holds a stop-work shut.",
          projectId: SEED.projectA,
          assignedToMemberId: SEED.pmMember,
          priority: "LOW",
        }),
      ),
    );
    expect(error.code).toBe("FORBIDDEN");

    const row = await prisma.hseAction.findUniqueOrThrow({
      where: { id: action.id },
      select: { priority: true },
    });
    expect(row.priority).toBe("CRITICAL");
  });

  it("the requester of a permit cannot approve it, whoever submitted it", async () => {
    const hse = await loginAs("HSE");
    const owner = await loginAs("OWNER");

    const permit = await permits.createPermit(hse, permitInput());
    created.permits.push(permit.id);
    await permits.submitPermit(owner, permit.id);

    const detail = await permits.getPermit(hse, permit.id);
    expect(detail.capabilities.canApprove).toBe(false);

    const error = await refusal(permits.approvePermit(hse, permit.id, null, await shownCycle("hse", permit.id)));
    expect(error.code).toBe("FORBIDDEN");
  });

  it("an incident waiting on its closure decision cannot be rewritten", async () => {
    const hse = await loginAs("HSE");
    const error = await refusal(
      incidents.updateIncident(
        hse,
        SEED.pendingCloseIncident,
        incidentSchema.parse({
          incidentType: "INCIDENT",
          title: "Rewritten while pending close",
          description: "Should be refused.",
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
          severity: "LOW",
        }),
      ),
    );
    expect(error.code).toBe("CONFLICT");
  });
});
