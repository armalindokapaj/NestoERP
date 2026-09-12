/**
 * HSE fixtures (PRD #22 §374–§386 and the DoD).
 *
 * The point of this seed is that **every state the module can be in is on
 * screen somewhere**, and that the three rules the module turns on are visible
 * without anybody having to create data first:
 *
 *   - an inspection sitting at PENDING_APPROVAL with a result of FAIL, so the
 *     status/result split is obvious the moment the list loads (§37, §38),
 *   - a hazard that cannot close because its action is unverified, and one that
 *     closed properly with its residual risk assessed (§73),
 *   - an incident that cannot close because it has no root cause, and one that
 *     did (§95),
 *   - a stop-work that cannot be released because a critical action against it
 *     is outstanding (§174),
 *   - a permit whose validity window has already closed while its stored status
 *     still says ACTIVE, which is the only way to see §151 working.
 *
 *   templates    12, one per inspection type with real checklists (§375)
 *   inspections  30 across every status and result (§375)
 *   hazards      35 across all categories and risk levels (§376)
 *   incidents    18 incidents + 12 near misses (§377)
 *   assessments  12 across draft, pending, approved, archived (§378)
 *   actions      35 across the verification workflow (§379)
 *   toolbox      14 talks with internal and external participants (§380)
 *   permits      12 across every type and status (§381)
 *   ppe          20 across pass, fail and conditional (§382)
 *   environment  14 across the categories (§383)
 *   stop work    5 across active, released and cancelled (§384)
 *   approvals    12 pending and decided (§374)
 *
 * The seed is idempotent: everything is addressed by a deterministic id and
 * upserted, so re-running it converges rather than duplicating.
 */
import type { PrismaClient } from "@prisma/client";

import { COMPANY_A, COMPANY_B, PROJECT_IDS, daysFromNow } from "./constants";
import { seedStoredDocument } from "./document-objects";

type Members = Map<string, string>;

/** `likelihood × severity`, banded exactly as `hse.risk.ts` does it (§64). */
function riskOf(likelihood: number, severity: number) {
  const riskScore = likelihood * severity;
  const riskLevel =
    riskScore <= 4 ? "LOW" : riskScore <= 9 ? "MEDIUM" : riskScore <= 16 ? "HIGH" : "CRITICAL";
  return { likelihood, severityScore: severity, riskScore, riskLevel } as const;
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}

export async function seedHseRecords(prisma: PrismaClient, members: Members) {
  const hse = members.get("user_hse")!;
  const pm = members.get("user_pm")!;
  const engineer = members.get("user_engineer")!;
  const owner = members.get("user_owner")!;
  const qaqc = members.get("user_qaqc")!;

  const people = { hse, pm, engineer, owner, qaqc };

  const templates = await seedTemplates(prisma, hse);
  const inspections = await seedInspections(prisma, people, templates);
  const hazards = await seedHazards(prisma, people, inspections);
  const incidents = await seedIncidents(prisma, people);
  const assessments = await seedRiskAssessments(prisma, people);
  const permits = await seedPermits(prisma, people, assessments);
  const observations = await seedEnvironmental(prisma, people);
  const stopWorks = await seedStopWork(prisma, people, hazards, incidents);
  const actions = await seedActions(prisma, people, {
    hazards,
    incidents,
    inspections,
    assessments,
    observations,
    stopWorks,
  });
  const toolbox = await seedToolbox(prisma, people);
  const ppe = await seedPpe(prisma, people);
  const approvals = await seedApprovals(prisma, people, {
    inspections,
    assessments,
    permits,
    incidents,
  });
  await seedHseDocuments(prisma);
  await seedCompanyBHse(prisma, members);

  return {
    templates: templates.length,
    inspections: inspections.length,
    hazards: hazards.length,
    incidents: incidents.length,
    assessments: assessments.length,
    actions,
    toolbox,
    permits: permits.length,
    ppe,
    observations: observations.length,
    stopWorks: stopWorks.length,
    approvals,
  };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

type TemplateFixture = {
  id: string;
  code: string;
  name: string;
  type:
    | "SITE_SAFETY"
    | "PPE"
    | "HOUSEKEEPING"
    | "WORK_AT_HEIGHT"
    | "ELECTRICAL"
    | "FIRE_SAFETY"
    | "EXCAVATION"
    | "LIFTING"
    | "ENVIRONMENTAL"
    | "GENERAL";
  status?: "ACTIVE" | "INACTIVE";
  version?: number;
  items: {
    code?: string;
    label: string;
    responseType?: "PASS_FAIL" | "PASS_FAIL_NA" | "BOOLEAN" | "TEXT" | "NUMBER";
    required?: boolean;
    risk?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    note?: boolean;
  }[];
};

const TEMPLATES: TemplateFixture[] = [
  {
    id: "hse_tpl_site",
    code: "HSE-SITE",
    name: "General site safety walk",
    type: "SITE_SAFETY",
    items: [
      { code: "S1", label: "Site is secure and signage is in place", risk: "MEDIUM", note: true },
      { code: "S2", label: "Access routes are clear and lit", risk: "MEDIUM", note: true },
      { code: "S3", label: "Welfare facilities are usable", responseType: "PASS_FAIL_NA" },
      { code: "S4", label: "First aid provision is present and in date", risk: "HIGH", note: true },
      { code: "S5", label: "Number of operatives on site", responseType: "NUMBER", required: false },
    ],
  },
  {
    id: "hse_tpl_ppe",
    code: "HSE-PPE",
    name: "PPE compliance walk",
    type: "PPE",
    items: [
      { code: "P1", label: "Everybody on site is wearing a helmet", risk: "HIGH", note: true },
      { code: "P2", label: "High-visibility clothing is worn", risk: "MEDIUM", note: true },
      { code: "P3", label: "Safety footwear is worn", risk: "MEDIUM" },
      { code: "P4", label: "Eye protection where required", responseType: "PASS_FAIL_NA" },
      { code: "P5", label: "Harnesses are inspected and in date", responseType: "PASS_FAIL_NA", risk: "CRITICAL", note: true },
    ],
  },
  {
    id: "hse_tpl_house",
    code: "HSE-HOUSE",
    name: "Housekeeping",
    type: "HOUSEKEEPING",
    items: [
      { code: "H1", label: "Walkways are clear of materials", risk: "MEDIUM", note: true },
      { code: "H2", label: "Waste is segregated and skips are not overfull" },
      { code: "H3", label: "Materials are stacked safely", risk: "MEDIUM" },
      { code: "H4", label: "Trailing leads are managed", risk: "HIGH", note: true },
    ],
  },
  {
    id: "hse_tpl_height",
    code: "HSE-HEIGHT",
    name: "Work at height",
    type: "WORK_AT_HEIGHT",
    items: [
      { code: "W1", label: "Edge protection is complete and secure", risk: "CRITICAL", note: true },
      { code: "W2", label: "Scaffold tag is current", risk: "CRITICAL", note: true },
      { code: "W3", label: "Ladders are secured and at the right angle", risk: "HIGH", note: true },
      { code: "W4", label: "Openings are covered and marked", risk: "CRITICAL", note: true },
      { code: "W5", label: "Harness anchor points are identified", responseType: "PASS_FAIL_NA", risk: "CRITICAL" },
    ],
  },
  {
    id: "hse_tpl_elec",
    code: "HSE-ELEC",
    name: "Electrical safety",
    type: "ELECTRICAL",
    items: [
      { code: "E1", label: "Temporary supplies are RCD protected", risk: "CRITICAL", note: true },
      { code: "E2", label: "Portable equipment is tested and labelled", risk: "HIGH", note: true },
      { code: "E3", label: "Cables are undamaged", risk: "HIGH", note: true },
      { code: "E4", label: "Distribution boards are locked", risk: "HIGH" },
    ],
  },
  {
    id: "hse_tpl_fire",
    code: "HSE-FIRE",
    name: "Fire safety",
    type: "FIRE_SAFETY",
    items: [
      { code: "F1", label: "Escape routes are clear", risk: "CRITICAL", note: true },
      { code: "F2", label: "Extinguishers are present and in date", risk: "HIGH", note: true },
      { code: "F3", label: "Assembly point is signed", risk: "MEDIUM" },
      { code: "F4", label: "Hot work areas have a fire watch", responseType: "PASS_FAIL_NA", risk: "CRITICAL", note: true },
    ],
  },
  {
    id: "hse_tpl_exc",
    code: "HSE-EXC",
    name: "Excavation",
    type: "EXCAVATION",
    items: [
      { code: "X1", label: "Sides are supported or battered", risk: "CRITICAL", note: true },
      { code: "X2", label: "Edge barriers are in place", risk: "CRITICAL", note: true },
      { code: "X3", label: "Services have been located and marked", risk: "CRITICAL", note: true },
      { code: "X4", label: "Safe access into the excavation", risk: "HIGH" },
      { code: "X5", label: "Depth in metres", responseType: "NUMBER", required: false },
    ],
  },
  {
    id: "hse_tpl_lift",
    code: "HSE-LIFT",
    name: "Lifting operations",
    type: "LIFTING",
    items: [
      { code: "L1", label: "Lift plan is on site and current", risk: "CRITICAL", note: true },
      { code: "L2", label: "Appointed person is present", risk: "HIGH" },
      { code: "L3", label: "Accessories are inspected and in date", risk: "CRITICAL", note: true },
      { code: "L4", label: "Exclusion zone is set up", risk: "HIGH", note: true },
    ],
  },
  {
    id: "hse_tpl_env",
    code: "HSE-ENV",
    name: "Environmental walk",
    type: "ENVIRONMENTAL",
    items: [
      { code: "N1", label: "Spill kits are available and stocked", risk: "MEDIUM", note: true },
      { code: "N2", label: "Fuel storage is bunded", risk: "HIGH", note: true },
      { code: "N3", label: "Dust suppression is in use", responseType: "PASS_FAIL_NA" },
      { code: "N4", label: "Water discharge is controlled", responseType: "PASS_FAIL_NA", risk: "MEDIUM" },
    ],
  },
  {
    id: "hse_tpl_general",
    code: "HSE-GEN",
    name: "General inspection",
    type: "GENERAL",
    items: [
      { code: "G1", label: "Findings", responseType: "TEXT", required: false },
      { code: "G2", label: "Site is generally in order", risk: "MEDIUM", note: true },
    ],
  },
  {
    /*
     * A superseded version, so the versioning rule is visible in the list
     * without anybody having to edit a template first (§349).
     */
    id: "hse_tpl_height_v1",
    code: "HSE-HEIGHT-OLD",
    name: "Work at height (superseded)",
    type: "WORK_AT_HEIGHT",
    status: "INACTIVE",
    items: [
      { code: "W1", label: "Edge protection is in place", risk: "HIGH", note: true },
      { code: "W2", label: "Scaffold has been checked", risk: "HIGH" },
    ],
  },
  {
    id: "hse_tpl_archived",
    code: "HSE-OLD",
    name: "Retired site check",
    type: "GENERAL",
    status: "INACTIVE",
    items: [{ code: "O1", label: "Site is tidy" }],
  },
];

async function seedTemplates(prisma: PrismaClient, hse: string) {
  for (const template of TEMPLATES) {
    await prisma.hseInspectionTemplate.upsert({
      where: { id: template.id },
      update: {
        name: template.name,
        status: template.status ?? "ACTIVE",
      },
      create: {
        id: template.id,
        companyId: COMPANY_A,
        code: template.code,
        name: template.name,
        inspectionType: template.type,
        description: `${template.name} — the checklist used for ${template.type.replace(/_/g, " ").toLowerCase()} inspections.`,
        version: template.version ?? 1,
        status: template.status ?? "ACTIVE",
        createdByMemberId: hse,
      },
    });

    const existing = await prisma.hseInspectionTemplateItem.count({
      where: { templateId: template.id },
    });
    if (existing > 0) continue;

    await prisma.hseInspectionTemplateItem.createMany({
      data: template.items.map((item, index) => ({
        templateId: template.id,
        code: item.code ?? null,
        label: item.label,
        responseType: item.responseType ?? "PASS_FAIL",
        required: item.required ?? true,
        sortOrder: index,
        riskIfFailed: item.risk ?? null,
        requiresNoteOnFail: item.note ?? false,
      })),
    });
  }

  return TEMPLATES;
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

type InspectionFixture = {
  id: string;
  number: string;
  template: string;
  project: keyof typeof PROJECT_IDS | null;
  status:
    | "DRAFT"
    | "SCHEDULED"
    | "IN_PROGRESS"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "REJECTED"
    | "CLOSED"
    | "CANCELLED";
  result: "NOT_SET" | "PASS" | "FAIL" | "CONDITIONAL";
  inspector: "hse" | "pm" | "engineer";
  daysAgo: number;
  location: string;
  /** Which checklist rows failed, by index, so results and answers agree. */
  failed?: number[];
};

const INSPECTIONS: InspectionFixture[] = [
  { id: "hse_ins_001", number: "HSE-INS-2026-0001", template: "hse_tpl_site", project: "a", status: "CLOSED", result: "PASS", inspector: "hse", daysAgo: 60, location: "Whole site" },
  { id: "hse_ins_002", number: "HSE-INS-2026-0002", template: "hse_tpl_height", project: "a", status: "CLOSED", result: "FAIL", inspector: "hse", daysAgo: 55, location: "Level 4 east", failed: [0, 3] },
  { id: "hse_ins_003", number: "HSE-INS-2026-0003", template: "hse_tpl_ppe", project: "b", status: "CLOSED", result: "PASS", inspector: "hse", daysAgo: 50, location: "Main gate" },
  { id: "hse_ins_004", number: "HSE-INS-2026-0004", template: "hse_tpl_elec", project: "a", status: "APPROVED", result: "CONDITIONAL", inspector: "hse", daysAgo: 40, location: "Basement plant room", failed: [1] },
  { id: "hse_ins_005", number: "HSE-INS-2026-0005", template: "hse_tpl_exc", project: "c", status: "APPROVED", result: "PASS", inspector: "engineer", daysAgo: 35, location: "Drainage run 3" },
  /*
   * The record that makes the split visible the moment the list loads: it is
   * waiting for a signature *and* it failed (§37, §38).
   */
  { id: "hse_ins_006", number: "HSE-INS-2026-0006", template: "hse_tpl_fire", project: "a", status: "PENDING_APPROVAL", result: "FAIL", inspector: "hse", daysAgo: 6, location: "Level 2 core", failed: [0, 1] },
  { id: "hse_ins_007", number: "HSE-INS-2026-0007", template: "hse_tpl_lift", project: "b", status: "PENDING_APPROVAL", result: "PASS", inspector: "hse", daysAgo: 4, location: "Crane base" },
  { id: "hse_ins_008", number: "HSE-INS-2026-0008", template: "hse_tpl_house", project: "a", status: "PENDING_APPROVAL", result: "CONDITIONAL", inspector: "pm", daysAgo: 3, location: "Level 1", failed: [0] },
  { id: "hse_ins_009", number: "HSE-INS-2026-0009", template: "hse_tpl_site", project: "d", status: "REJECTED", result: "PASS", inspector: "engineer", daysAgo: 12, location: "Compound" },
  { id: "hse_ins_010", number: "HSE-INS-2026-0010", template: "hse_tpl_height", project: "a", status: "IN_PROGRESS", result: "NOT_SET", inspector: "hse", daysAgo: 1, location: "Level 5 west" },
  { id: "hse_ins_011", number: "HSE-INS-2026-0011", template: "hse_tpl_ppe", project: "b", status: "IN_PROGRESS", result: "NOT_SET", inspector: "pm", daysAgo: 0, location: "Level 3" },
  { id: "hse_ins_012", number: "HSE-INS-2026-0012", template: "hse_tpl_env", project: "c", status: "SCHEDULED", result: "NOT_SET", inspector: "hse", daysAgo: -3, location: "Fuel compound" },
  { id: "hse_ins_013", number: "HSE-INS-2026-0013", template: "hse_tpl_fire", project: "a", status: "SCHEDULED", result: "NOT_SET", inspector: "hse", daysAgo: -5, location: "All levels" },
  { id: "hse_ins_014", number: "HSE-INS-2026-0014", template: "hse_tpl_exc", project: "c", status: "SCHEDULED", result: "NOT_SET", inspector: "engineer", daysAgo: -7, location: "Foundation pit" },
  { id: "hse_ins_015", number: "HSE-INS-2026-0015", template: "hse_tpl_general", project: null, status: "DRAFT", result: "NOT_SET", inspector: "hse", daysAgo: 0, location: "Head office" },
  { id: "hse_ins_016", number: "HSE-INS-2026-0016", template: "hse_tpl_site", project: "b", status: "DRAFT", result: "NOT_SET", inspector: "hse", daysAgo: 0, location: "Site entrance" },
  { id: "hse_ins_017", number: "HSE-INS-2026-0017", template: "hse_tpl_lift", project: "a", status: "CANCELLED", result: "NOT_SET", inspector: "hse", daysAgo: 20, location: "Duplicate" },
  { id: "hse_ins_018", number: "HSE-INS-2026-0018", template: "hse_tpl_house", project: "d", status: "CLOSED", result: "PASS", inspector: "pm", daysAgo: 45, location: "Level 1" },
  { id: "hse_ins_019", number: "HSE-INS-2026-0019", template: "hse_tpl_elec", project: "b", status: "CLOSED", result: "CONDITIONAL", inspector: "hse", daysAgo: 42, location: "Riser 2", failed: [2] },
  { id: "hse_ins_020", number: "HSE-INS-2026-0020", template: "hse_tpl_ppe", project: "a", status: "CLOSED", result: "FAIL", inspector: "hse", daysAgo: 38, location: "Level 2", failed: [0, 4] },
  { id: "hse_ins_021", number: "HSE-INS-2026-0021", template: "hse_tpl_env", project: "c", status: "APPROVED", result: "PASS", inspector: "hse", daysAgo: 30, location: "Wash-out area" },
  { id: "hse_ins_022", number: "HSE-INS-2026-0022", template: "hse_tpl_site", project: "e", status: "APPROVED", result: "PASS", inspector: "pm", daysAgo: 28, location: "Whole site" },
  { id: "hse_ins_023", number: "HSE-INS-2026-0023", template: "hse_tpl_height", project: "b", status: "APPROVED", result: "CONDITIONAL", inspector: "hse", daysAgo: 25, location: "Scaffold bay 4", failed: [2] },
  { id: "hse_ins_024", number: "HSE-INS-2026-0024", template: "hse_tpl_fire", project: "d", status: "CLOSED", result: "PASS", inspector: "hse", daysAgo: 22, location: "Level 1" },
  { id: "hse_ins_025", number: "HSE-INS-2026-0025", template: "hse_tpl_exc", project: "c", status: "CLOSED", result: "FAIL", inspector: "engineer", daysAgo: 18, location: "Trench B", failed: [0, 2] },
  { id: "hse_ins_026", number: "HSE-INS-2026-0026", template: "hse_tpl_lift", project: "a", status: "APPROVED", result: "PASS", inspector: "hse", daysAgo: 15, location: "Tower crane" },
  { id: "hse_ins_027", number: "HSE-INS-2026-0027", template: "hse_tpl_house", project: "b", status: "CLOSED", result: "CONDITIONAL", inspector: "pm", daysAgo: 14, location: "Level 4", failed: [1] },
  { id: "hse_ins_028", number: "HSE-INS-2026-0028", template: "hse_tpl_general", project: "f", status: "CLOSED", result: "PASS", inspector: "hse", daysAgo: 10, location: "Site office" },
  { id: "hse_ins_029", number: "HSE-INS-2026-0029", template: "hse_tpl_site", project: "a", status: "APPROVED", result: "PASS", inspector: "hse", daysAgo: 8, location: "Perimeter" },
  { id: "hse_ins_030", number: "HSE-INS-2026-0030", template: "hse_tpl_elec", project: "c", status: "IN_PROGRESS", result: "NOT_SET", inspector: "engineer", daysAgo: 0, location: "Temporary supply" },
];

async function seedInspections(
  prisma: PrismaClient,
  people: Record<string, string>,
  templates: TemplateFixture[],
) {
  const byId = new Map(templates.map((template) => [template.id, template]));

  for (const fixture of INSPECTIONS) {
    const template = byId.get(fixture.template)!;
    const inspector = people[fixture.inspector]!;
    const decided = ["APPROVED", "REJECTED", "CLOSED"].includes(fixture.status);
    const executed = !["DRAFT", "SCHEDULED", "CANCELLED"].includes(fixture.status);

    await prisma.hseInspection.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status, result: fixture.result },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        inspectionNumber: fixture.number,
        inspectionType: template.type,
        projectId: fixture.project ? PROJECT_IDS[fixture.project] : null,
        templateId: template.id,
        templateVersion: template.version ?? 1,
        assignedInspectorMemberId: inspector,
        executedByMemberId: executed ? inspector : null,
        status: fixture.status,
        result: fixture.result,
        scheduledDate: daysFromNow(-fixture.daysAgo),
        inspectionDate: executed ? daysFromNow(-fixture.daysAgo) : null,
        locationText: fixture.location,
        summary:
          fixture.result === "PASS"
            ? "Nothing outstanding at the time of the walk."
            : fixture.result === "NOT_SET"
              ? null
              : "Findings recorded against the failed checks below.",
        submittedAt: executed && fixture.status !== "IN_PROGRESS" ? daysFromNow(-fixture.daysAgo) : null,
        approvedAt: fixture.status === "APPROVED" || fixture.status === "CLOSED" ? daysFromNow(-fixture.daysAgo + 1) : null,
        approvedByMemberId: fixture.status === "APPROVED" || fixture.status === "CLOSED" ? people.owner! : null,
        rejectedAt: fixture.status === "REJECTED" ? daysFromNow(-fixture.daysAgo + 1) : null,
        rejectedByMemberId: fixture.status === "REJECTED" ? people.owner! : null,
        decisionNote:
          fixture.status === "REJECTED"
            ? "The welfare check was marked pass with no note — please walk it again."
            : null,
        closedAt: fixture.status === "CLOSED" ? daysFromNow(-fixture.daysAgo + 2) : null,
        closedByMemberId: fixture.status === "CLOSED" ? people.hse! : null,
        cancelledAt: fixture.status === "CANCELLED" ? daysFromNow(-fixture.daysAgo) : null,
        createdByMemberId: people.hse!,
      },
    });

    const existing = await prisma.hseInspectionChecklistItem.count({
      where: { inspectionId: fixture.id },
    });
    if (existing > 0) continue;

    // The checklist is a snapshot: copied as the template stood, and answered
    // so the answers and the overall result agree (§47, §49).
    await prisma.hseInspectionChecklistItem.createMany({
      data: template.items.map((item, index) => {
        const failed = fixture.failed?.includes(index) ?? false;
        const answered = executed;
        const isValue = item.responseType === "TEXT" || item.responseType === "NUMBER";

        return {
          inspectionId: fixture.id,
          code: item.code ?? null,
          label: item.label,
          responseType: item.responseType ?? "PASS_FAIL",
          required: item.required ?? true,
          sortOrder: index,
          responseValue: answered && isValue ? (item.responseType === "NUMBER" ? "12" : "Walked with the site manager.") : null,
          result: answered ? (failed ? "FAIL" : "PASS") : null,
          note: answered && failed ? "Recorded on the walk and raised as a hazard." : null,
          riskIfFailed: item.risk ?? null,
          requiresNoteOnFail: item.note ?? false,
        };
      }),
    });
  }

  return INSPECTIONS;
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

type HazardFixture = {
  id: string;
  number: string;
  title: string;
  category: string;
  likelihood: number;
  severity: number;
  status: "OPEN" | "CONTROLLED" | "IN_PROGRESS" | "PENDING_VERIFICATION" | "CLOSED" | "CANCELLED" | "REOPENED";
  project: keyof typeof PROJECT_IDS | null;
  reporter: "hse" | "pm" | "engineer" | "qaqc";
  assignee?: "hse" | "pm" | "engineer";
  daysAgo: number;
  inspection?: string;
  residual?: [number, number];
  location?: string;
};

const HAZARDS: HazardFixture[] = [
  { id: "hse_hz_001", number: "HZ-2026-0001", title: "Edge protection missing on level 4 east", category: "WORK_AT_HEIGHT", likelihood: 4, severity: 5, status: "CLOSED", project: "a", reporter: "hse", assignee: "pm", daysAgo: 55, inspection: "hse_ins_002", residual: [1, 5], location: "Level 4 east" },
  { id: "hse_hz_002", number: "HZ-2026-0002", title: "Uncovered riser opening", category: "WORK_AT_HEIGHT", likelihood: 4, severity: 5, status: "OPEN", project: "a", reporter: "hse", assignee: "pm", daysAgo: 2, location: "Level 5 core" },
  { id: "hse_hz_003", number: "HZ-2026-0003", title: "Distribution board left unlocked", category: "ELECTRICAL", likelihood: 3, severity: 4, status: "CONTROLLED", project: "a", reporter: "hse", assignee: "engineer", daysAgo: 40, inspection: "hse_ins_004", location: "Basement plant room" },
  { id: "hse_hz_004", number: "HZ-2026-0004", title: "Fire escape route blocked by materials", category: "FIRE", likelihood: 4, severity: 5, status: "IN_PROGRESS", project: "a", reporter: "hse", assignee: "pm", daysAgo: 6, inspection: "hse_ins_006", location: "Level 2 core" },
  { id: "hse_hz_005", number: "HZ-2026-0005", title: "Extinguisher out of test date", category: "FIRE", likelihood: 3, severity: 3, status: "OPEN", project: "a", reporter: "hse", assignee: "hse", daysAgo: 6, inspection: "hse_ins_006", location: "Level 2" },
  { id: "hse_hz_006", number: "HZ-2026-0006", title: "Excavation sides unsupported", category: "EXCAVATION", likelihood: 4, severity: 5, status: "CLOSED", project: "c", reporter: "engineer", assignee: "engineer", daysAgo: 18, inspection: "hse_ins_025", residual: [1, 5], location: "Trench B" },
  { id: "hse_hz_007", number: "HZ-2026-0007", title: "Buried services not marked", category: "EXCAVATION", likelihood: 3, severity: 5, status: "PENDING_VERIFICATION", project: "c", reporter: "engineer", assignee: "hse", daysAgo: 17, inspection: "hse_ins_025", location: "Trench B" },
  { id: "hse_hz_008", number: "HZ-2026-0008", title: "Lifting accessory without a current certificate", category: "LIFTING", likelihood: 3, severity: 5, status: "CLOSED", project: "a", reporter: "hse", assignee: "pm", daysAgo: 30, residual: [1, 5], location: "Crane base" },
  { id: "hse_hz_009", number: "HZ-2026-0009", title: "Trailing leads across a walkway", category: "HOUSEKEEPING", likelihood: 4, severity: 2, status: "CLOSED", project: "b", reporter: "pm", assignee: "pm", daysAgo: 14, inspection: "hse_ins_027", residual: [1, 2], location: "Level 4" },
  { id: "hse_hz_010", number: "HZ-2026-0010", title: "Walkway obstructed by stacked plasterboard", category: "HOUSEKEEPING", likelihood: 3, severity: 2, status: "OPEN", project: "a", reporter: "pm", assignee: "pm", daysAgo: 3, inspection: "hse_ins_008", location: "Level 1" },
  { id: "hse_hz_011", number: "HZ-2026-0011", title: "Operatives without helmets near the gate", category: "PPE", likelihood: 4, severity: 4, status: "CLOSED", project: "a", reporter: "hse", assignee: "hse", daysAgo: 38, inspection: "hse_ins_020", residual: [2, 4], location: "Level 2" },
  { id: "hse_hz_012", number: "HZ-2026-0012", title: "Harness inspection tags missing", category: "PPE", likelihood: 3, severity: 5, status: "IN_PROGRESS", project: "a", reporter: "hse", assignee: "hse", daysAgo: 38, inspection: "hse_ins_020", location: "Level 2" },
  { id: "hse_hz_013", number: "HZ-2026-0013", title: "Unbunded fuel drum in the compound", category: "ENVIRONMENTAL", likelihood: 3, severity: 3, status: "CONTROLLED", project: "c", reporter: "hse", assignee: "engineer", daysAgo: 25, location: "Fuel compound" },
  { id: "hse_hz_014", number: "HZ-2026-0014", title: "Dust from cutting with no suppression", category: "ENVIRONMENTAL", likelihood: 4, severity: 3, status: "OPEN", project: "b", reporter: "engineer", assignee: "pm", daysAgo: 5, location: "Level 3" },
  { id: "hse_hz_015", number: "HZ-2026-0015", title: "Reversing vehicles with no banksman", category: "VEHICLE", likelihood: 3, severity: 5, status: "CONTROLLED", project: "a", reporter: "pm", assignee: "pm", daysAgo: 20, location: "Site entrance" },
  { id: "hse_hz_016", number: "HZ-2026-0016", title: "Forklift operating close to pedestrians", category: "VEHICLE", likelihood: 3, severity: 4, status: "OPEN", project: "d", reporter: "pm", assignee: "pm", daysAgo: 9, location: "Material yard" },
  { id: "hse_hz_017", number: "HZ-2026-0017", title: "Bench saw guard removed", category: "MACHINERY", likelihood: 4, severity: 4, status: "CLOSED", project: "b", reporter: "engineer", assignee: "engineer", daysAgo: 33, residual: [1, 4], location: "Joinery shop" },
  { id: "hse_hz_018", number: "HZ-2026-0018", title: "Compressor with a damaged hose", category: "MACHINERY", likelihood: 3, severity: 3, status: "PENDING_VERIFICATION", project: "a", reporter: "engineer", assignee: "engineer", daysAgo: 11, location: "Level 1" },
  { id: "hse_hz_019", number: "HZ-2026-0019", title: "Unlabelled chemical containers", category: "CHEMICAL", likelihood: 3, severity: 4, status: "OPEN", project: "c", reporter: "hse", assignee: "hse", daysAgo: 7, location: "Store" },
  { id: "hse_hz_020", number: "HZ-2026-0020", title: "Solvent stored beside hot work", category: "CHEMICAL", likelihood: 3, severity: 5, status: "CLOSED", project: "a", reporter: "hse", assignee: "hse", daysAgo: 27, residual: [1, 5], location: "Level 2" },
  { id: "hse_hz_021", number: "HZ-2026-0021", title: "Manual handling of heavy kerbs", category: "ERGONOMIC", likelihood: 4, severity: 2, status: "CONTROLLED", project: "c", reporter: "engineer", assignee: "engineer", daysAgo: 21, location: "External works" },
  { id: "hse_hz_022", number: "HZ-2026-0022", title: "Repeated overhead reaching at a workstation", category: "ERGONOMIC", likelihood: 3, severity: 2, status: "OPEN", project: "f", reporter: "pm", daysAgo: 13, location: "Site office" },
  { id: "hse_hz_023", number: "HZ-2026-0023", title: "Scaffold tag out of date", category: "WORK_AT_HEIGHT", likelihood: 3, severity: 5, status: "REOPENED", project: "b", reporter: "hse", assignee: "pm", daysAgo: 25, inspection: "hse_ins_023", location: "Scaffold bay 4" },
  { id: "hse_hz_024", number: "HZ-2026-0024", title: "Ladder not secured at the top", category: "WORK_AT_HEIGHT", likelihood: 4, severity: 4, status: "OPEN", project: "b", reporter: "pm", assignee: "pm", daysAgo: 4, location: "Level 2" },
  { id: "hse_hz_025", number: "HZ-2026-0025", title: "Temporary supply without RCD protection", category: "ELECTRICAL", likelihood: 3, severity: 5, status: "IN_PROGRESS", project: "c", reporter: "engineer", assignee: "engineer", daysAgo: 1, location: "Temporary supply" },
  { id: "hse_hz_026", number: "HZ-2026-0026", title: "Damaged extension lead in use", category: "ELECTRICAL", likelihood: 4, severity: 3, status: "CLOSED", project: "b", reporter: "hse", assignee: "hse", daysAgo: 42, inspection: "hse_ins_019", residual: [1, 3], location: "Riser 2" },
  { id: "hse_hz_027", number: "HZ-2026-0027", title: "Skip overfull and obstructing a route", category: "HOUSEKEEPING", likelihood: 2, severity: 2, status: "CLOSED", project: "d", reporter: "pm", assignee: "pm", daysAgo: 46, residual: [1, 2], location: "Compound" },
  { id: "hse_hz_028", number: "HZ-2026-0028", title: "Oil sheen near the wash-out area", category: "ENVIRONMENTAL", likelihood: 2, severity: 3, status: "CONTROLLED", project: "c", reporter: "hse", assignee: "hse", daysAgo: 30, location: "Wash-out area" },
  { id: "hse_hz_029", number: "HZ-2026-0029", title: "Gas bottles stored horizontally", category: "FIRE", likelihood: 2, severity: 4, status: "OPEN", project: "a", reporter: "hse", assignee: "hse", daysAgo: 8, location: "Compound" },
  { id: "hse_hz_030", number: "HZ-2026-0030", title: "Excavation edge barrier incomplete", category: "EXCAVATION", likelihood: 3, severity: 4, status: "CONTROLLED", project: "c", reporter: "engineer", assignee: "engineer", daysAgo: 16, location: "Foundation pit" },
  { id: "hse_hz_031", number: "HZ-2026-0031", title: "Lift plan not available on site", category: "LIFTING", likelihood: 2, severity: 5, status: "CLOSED", project: "b", reporter: "hse", assignee: "hse", daysAgo: 35, residual: [1, 5], location: "Crane base" },
  { id: "hse_hz_032", number: "HZ-2026-0032", title: "Poor lighting on a temporary stair", category: "OTHER", likelihood: 3, severity: 3, status: "OPEN", project: "e", reporter: "pm", assignee: "pm", daysAgo: 10, location: "Stair core" },
  { id: "hse_hz_033", number: "HZ-2026-0033", title: "Noise above limits without protection", category: "OTHER", likelihood: 4, severity: 2, status: "CONTROLLED", project: "b", reporter: "qaqc", assignee: "hse", daysAgo: 19, location: "Level 3" },
  { id: "hse_hz_034", number: "HZ-2026-0034", title: "Duplicate report of the blocked walkway", category: "HOUSEKEEPING", likelihood: 2, severity: 2, status: "CANCELLED", project: "a", reporter: "pm", daysAgo: 3, location: "Level 1" },
  { id: "hse_hz_035", number: "HZ-2026-0035", title: "Unsecured materials at height in wind", category: "WORK_AT_HEIGHT", likelihood: 4, severity: 5, status: "OPEN", project: "a", reporter: "hse", assignee: "hse", daysAgo: 0, location: "Level 5 west" },
];

async function seedHazards(
  prisma: PrismaClient,
  people: Record<string, string>,
  inspections: InspectionFixture[],
) {
  const known = new Set(inspections.map((inspection) => inspection.id));

  for (const fixture of HAZARDS) {
    const risk = riskOf(fixture.likelihood, fixture.severity);
    const closed = fixture.status === "CLOSED";
    const residual = fixture.residual ? riskOf(fixture.residual[0], fixture.residual[1]) : null;
    const controlled = ["CONTROLLED", "IN_PROGRESS", "PENDING_VERIFICATION", "CLOSED", "REOPENED"].includes(
      fixture.status,
    );

    await prisma.hseHazard.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        hazardNumber: fixture.number,
        title: fixture.title,
        description: `${fixture.title}. Seen on a routine walk and recorded straight away.`,
        projectId: fixture.project ? PROJECT_IDS[fixture.project] : null,
        inspectionId: fixture.inspection && known.has(fixture.inspection) ? fixture.inspection : null,
        hazardCategory: fixture.category as never,
        likelihood: risk.likelihood,
        severityScore: risk.severityScore,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        residualLikelihood: residual?.likelihood ?? null,
        residualSeverity: residual?.severityScore ?? null,
        residualRiskScore: residual?.riskScore ?? null,
        residualRiskLevel: residual?.riskLevel ?? null,
        status: fixture.status,
        locationText: fixture.location ?? null,
        observedAt: daysFromNow(-fixture.daysAgo),
        reportedByMemberId: people[fixture.reporter]!,
        assignedToMemberId: fixture.assignee ? people[fixture.assignee]! : null,
        // A critical hazard always carries its immediate control (§68).
        immediateControl:
          risk.riskLevel === "CRITICAL"
            ? "Area barricaded and the work stopped until it was made safe."
            : controlled
              ? "Made safe at the time."
              : null,
        controlMeasure: controlled ? "Permanent control installed and checked." : null,
        dueDate: closed ? null : daysFromNow(fixture.daysAgo > 10 ? -2 : 7),
        closedAt: closed ? daysFromNow(-fixture.daysAgo + 5) : null,
        closedByMemberId: closed ? people.hse! : null,
        closureNote: closed ? "Control verified in place and the residual risk accepted." : null,
        cancelledAt: fixture.status === "CANCELLED" ? daysFromNow(-fixture.daysAgo) : null,
        createdByMemberId: people[fixture.reporter]!,
      },
    });
  }

  return HAZARDS;
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

type IncidentFixture = {
  id: string;
  number: string;
  type: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "UNDER_INVESTIGATION" | "ACTIONS_OPEN" | "PENDING_CLOSE" | "CLOSED" | "CANCELLED" | "REOPENED";
  project: keyof typeof PROJECT_IDS | null;
  reporter: "hse" | "pm" | "engineer" | "qaqc";
  investigator?: "hse" | "pm";
  daysAgo: number;
  injury?: boolean;
  firstAid?: boolean;
  treatment?: boolean;
  lostTime?: boolean;
  property?: boolean;
  environmental?: boolean;
  rootCause?: string | null;
};

const INCIDENTS: IncidentFixture[] = [
  { id: "hse_inc_001", number: "INC-2026-0001", type: "INCIDENT", title: "Operative struck by falling batten", severity: "HIGH", status: "CLOSED", project: "a", reporter: "hse", investigator: "hse", daysAgo: 70, injury: true, firstAid: true, rootCause: "Materials were not secured at the edge before the wind picked up; the exclusion zone below was not enforced." },
  { id: "hse_inc_002", number: "INC-2026-0002", type: "INCIDENT", title: "Slip on wet temporary stair", severity: "MEDIUM", status: "CLOSED", project: "b", reporter: "pm", investigator: "pm", daysAgo: 64, injury: true, firstAid: true, rootCause: "No drainage on the temporary stair and no anti-slip treads." },
  { id: "hse_inc_003", number: "INC-2026-0003", type: "FIRST_AID", title: "Grit in eye while cutting", severity: "LOW", status: "CLOSED", project: "a", reporter: "engineer", investigator: "hse", daysAgo: 58, injury: true, firstAid: true, rootCause: null },
  { id: "hse_inc_004", number: "INC-2026-0004", type: "INCIDENT", title: "Fall from a ladder", severity: "CRITICAL", status: "CLOSED", project: "b", reporter: "hse", investigator: "hse", daysAgo: 52, injury: true, treatment: true, lostTime: true, rootCause: "Ladder was not secured and was used for work that should have been done from a tower." },
  { id: "hse_inc_005", number: "INC-2026-0005", type: "PROPERTY_DAMAGE", title: "Excavator caught a temporary supply cable", severity: "MEDIUM", status: "CLOSED", project: "c", reporter: "engineer", investigator: "hse", daysAgo: 46, property: true, rootCause: "Services had been marked but the marks had worn off and were not refreshed." },
  { id: "hse_inc_006", number: "INC-2026-0006", type: "ENVIRONMENTAL_EVENT", title: "Diesel spill in the compound", severity: "MEDIUM", status: "CLOSED", project: "c", reporter: "hse", investigator: "hse", daysAgo: 40, environmental: true, rootCause: "Drum was decanted outside the bund because the bunded area was full." },
  { id: "hse_inc_007", number: "INC-2026-0007", type: "VEHICLE_EVENT", title: "Delivery lorry clipped a gate post", severity: "LOW", status: "CLOSED", project: "a", reporter: "pm", investigator: "pm", daysAgo: 36, property: true, rootCause: null },
  { id: "hse_inc_008", number: "INC-2026-0008", type: "FIRE_EVENT", title: "Small fire in a waste skip", severity: "HIGH", status: "CLOSED", project: "b", reporter: "hse", investigator: "hse", daysAgo: 32, property: true, rootCause: "Hot work was carried out beside the skip without a fire watch." },
  { id: "hse_inc_009", number: "INC-2026-0009", type: "INCIDENT", title: "Hand laceration from an unguarded saw", severity: "HIGH", status: "PENDING_CLOSE", project: "b", reporter: "engineer", investigator: "hse", daysAgo: 28, injury: true, treatment: true, rootCause: "The guard had been removed to speed up repeat cuts and was not replaced." },
  { id: "hse_inc_010", number: "INC-2026-0010", type: "INCIDENT", title: "Operative overcome by fumes in a riser", severity: "CRITICAL", status: "ACTIONS_OPEN", project: "a", reporter: "hse", investigator: "hse", daysAgo: 20, injury: true, treatment: true, lostTime: true, rootCause: "Coating was applied in an unventilated riser with no confined-space permit." },
  /*
   * Deliberately without a root cause, so the closure rule is visible without
   * anybody having to break one first (§95, §363).
   */
  { id: "hse_inc_011", number: "INC-2026-0011", type: "INCIDENT", title: "Scaffold board slipped underfoot", severity: "HIGH", status: "UNDER_INVESTIGATION", project: "b", reporter: "pm", investigator: "hse", daysAgo: 12, injury: true, firstAid: true, rootCause: null },
  { id: "hse_inc_012", number: "INC-2026-0012", type: "INCIDENT", title: "Material dropped from level 3", severity: "HIGH", status: "OPEN", project: "a", reporter: "hse", daysAgo: 5, property: true, rootCause: null },
  { id: "hse_inc_013", number: "INC-2026-0013", type: "PROPERTY_DAMAGE", title: "Window unit cracked during handling", severity: "LOW", status: "OPEN", project: "d", reporter: "pm", daysAgo: 4, property: true, rootCause: null },
  { id: "hse_inc_014", number: "INC-2026-0014", type: "FIRST_AID", title: "Splinter requiring first aid", severity: "LOW", status: "CLOSED", project: "c", reporter: "engineer", investigator: "pm", daysAgo: 24, injury: true, firstAid: true, rootCause: null },
  { id: "hse_inc_015", number: "INC-2026-0015", type: "ENVIRONMENTAL_EVENT", title: "Silty water discharged to a drain", severity: "MEDIUM", status: "ACTIONS_OPEN", project: "c", reporter: "hse", investigator: "hse", daysAgo: 16, environmental: true, rootCause: "Settlement tank was bypassed while it was being cleaned." },
  { id: "hse_inc_016", number: "INC-2026-0016", type: "VEHICLE_EVENT", title: "Dumper tipped on soft ground", severity: "HIGH", status: "REOPENED", project: "c", reporter: "engineer", investigator: "hse", daysAgo: 44, property: true, rootCause: "Haul route was not maintained after heavy rain." },
  { id: "hse_inc_017", number: "INC-2026-0017", type: "OTHER", title: "Aggressive behaviour at the site gate", severity: "MEDIUM", status: "CLOSED", project: "a", reporter: "pm", investigator: "pm", daysAgo: 50, rootCause: null },
  { id: "hse_inc_018", number: "INC-2026-0018", type: "INCIDENT", title: "Duplicate report of the skip fire", severity: "LOW", status: "CANCELLED", project: "b", reporter: "qaqc", daysAgo: 32, rootCause: null },

  /* Near misses — the same model, which is the whole point (§82). */
  { id: "hse_nm_001", number: "INC-2026-0019", type: "NEAR_MISS", title: "Brick fell inside the exclusion zone", severity: "HIGH", status: "CLOSED", project: "a", reporter: "hse", investigator: "hse", daysAgo: 62, rootCause: "Debris netting had a tear that was not picked up on the scaffold check." },
  { id: "hse_nm_002", number: "INC-2026-0020", type: "NEAR_MISS", title: "Operative stepped back towards an open riser", severity: "CRITICAL", status: "CLOSED", project: "a", reporter: "pm", investigator: "hse", daysAgo: 54, rootCause: "The riser cover had been lifted for a delivery and not replaced." },
  { id: "hse_nm_003", number: "INC-2026-0021", type: "NEAR_MISS", title: "Reversing lorry with nobody banking", severity: "HIGH", status: "CLOSED", project: "a", reporter: "pm", investigator: "pm", daysAgo: 48, rootCause: "The banksman had been pulled onto another task." },
  { id: "hse_nm_004", number: "INC-2026-0022", type: "NEAR_MISS", title: "Load swung close to the scaffold", severity: "HIGH", status: "ACTIONS_OPEN", project: "b", reporter: "hse", investigator: "hse", daysAgo: 26, rootCause: "Tag lines were not used on a long load." },
  { id: "hse_nm_005", number: "INC-2026-0023", type: "NEAR_MISS", title: "Live cable found in a wall being chased", severity: "CRITICAL", status: "UNDER_INVESTIGATION", project: "b", reporter: "engineer", investigator: "hse", daysAgo: 18, rootCause: null },
  { id: "hse_nm_006", number: "INC-2026-0024", type: "NEAR_MISS", title: "Gas bottle toppled in the compound", severity: "MEDIUM", status: "OPEN", project: "a", reporter: "hse", daysAgo: 8, rootCause: null },
  { id: "hse_nm_007", number: "INC-2026-0025", type: "NEAR_MISS", title: "Trench edge crumbled with nobody inside", severity: "HIGH", status: "OPEN", project: "c", reporter: "engineer", daysAgo: 7, rootCause: null },
  { id: "hse_nm_008", number: "INC-2026-0026", type: "NEAR_MISS", title: "Scissor lift moved with the guardrail down", severity: "MEDIUM", status: "CLOSED", project: "d", reporter: "pm", investigator: "pm", daysAgo: 34, rootCause: null },
  { id: "hse_nm_009", number: "INC-2026-0027", type: "NEAR_MISS", title: "Slip on spilled adhesive", severity: "LOW", status: "CLOSED", project: "b", reporter: "engineer", investigator: "pm", daysAgo: 30, rootCause: null },
  { id: "hse_nm_010", number: "INC-2026-0028", type: "NEAR_MISS", title: "Angle grinder kicked back", severity: "MEDIUM", status: "OPEN", project: "b", reporter: "engineer", daysAgo: 6, rootCause: null },
  { id: "hse_nm_011", number: "INC-2026-0029", type: "NEAR_MISS", title: "Pedestrian crossed a plant route", severity: "MEDIUM", status: "CLOSED", project: "c", reporter: "pm", investigator: "pm", daysAgo: 22, rootCause: null },
  { id: "hse_nm_012", number: "INC-2026-0030", type: "NEAR_MISS", title: "Unsecured ladder shifted in use", severity: "HIGH", status: "PENDING_CLOSE", project: "e", reporter: "hse", investigator: "hse", daysAgo: 14, rootCause: "Ladder was footed rather than tied because no tie point was available." },
];

async function seedIncidents(prisma: PrismaClient, people: Record<string, string>) {
  for (const fixture of INCIDENTS) {
    const closed = fixture.status === "CLOSED";
    const investigating = fixture.investigator !== undefined;
    const serious = fixture.severity === "HIGH" || fixture.severity === "CRITICAL";

    await prisma.hseIncident.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        incidentNumber: fixture.number,
        incidentType: fixture.type as never,
        title: fixture.title,
        description: `${fixture.title}. Reported at the time and recorded here.`,
        projectId: fixture.project ? PROJECT_IDS[fixture.project] : null,
        occurredAt: daysFromNow(-fixture.daysAgo),
        reportedAt: daysFromNow(-fixture.daysAgo),
        locationText: "On site",
        severity: fixture.severity,
        status: fixture.status,
        reportedByMemberId: people[fixture.reporter]!,
        investigatorMemberId: fixture.investigator ? people[fixture.investigator]! : null,
        // Flags only. There is no diagnosis field to fill in (§22, §87).
        injuryOccurred: fixture.injury ?? false,
        firstAidRequired: fixture.firstAid ?? false,
        medicalTreatmentRequired: fixture.treatment ?? false,
        lostTime: fixture.lostTime ?? false,
        propertyDamage: fixture.property ?? false,
        environmentalImpact: fixture.environmental ?? false,
        // A serious incident always carries the immediate action (§362).
        immediateAction: serious
          ? "Work stopped in the area, the person was attended to and the site was made safe."
          : "Area made safe.",
        investigationSummary: investigating
          ? "Walked the area with the supervisor, spoke to those present and reviewed the method."
          : null,
        rootCause: fixture.rootCause ?? null,
        lessonsLearned: closed ? "Covered in the next toolbox talk and the method updated." : null,
        dueDate: closed ? null : daysFromNow(fixture.daysAgo > 14 ? -1 : 10),
        submittedForCloseAt:
          fixture.status === "PENDING_CLOSE" || closed ? daysFromNow(-fixture.daysAgo + 6) : null,
        closedAt: closed ? daysFromNow(-fixture.daysAgo + 8) : null,
        closedByMemberId: closed ? people.owner! : null,
        closureNote: closed || fixture.status === "PENDING_CLOSE"
          ? "Cause understood, controls in place and verified."
          : null,
        cancelledAt: fixture.status === "CANCELLED" ? daysFromNow(-fixture.daysAgo) : null,
        createdByMemberId: people[fixture.reporter]!,
      },
    });
  }

  return INCIDENTS;
}

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

type AssessmentFixture = {
  id: string;
  number: string;
  version?: number;
  title: string;
  activity: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ARCHIVED";
  project: keyof typeof PROJECT_IDS | null;
  owner: "hse" | "pm" | "engineer";
  daysAgo: number;
  reviewInDays?: number;
  items: { hazard: string; likelihood: number; severity: number; residual?: [number, number] }[];
};

const ASSESSMENTS: AssessmentFixture[] = [
  {
    id: "hse_ra_001", number: "RA-2026-0001", title: "Steel erection", activity: "Structural steel", status: "APPROVED", project: "a", owner: "engineer", daysAgo: 90, reviewInDays: 30,
    items: [
      { hazard: "Falling from the steel frame", likelihood: 3, severity: 5, residual: [1, 5] },
      { hazard: "Dropped tools onto people below", likelihood: 3, severity: 4, residual: [1, 4] },
      { hazard: "Crane contact with the structure", likelihood: 2, severity: 5, residual: [1, 5] },
    ],
  },
  {
    id: "hse_ra_002", number: "RA-2026-0002", title: "Deep excavation", activity: "Groundworks", status: "APPROVED", project: "c", owner: "engineer", daysAgo: 80, reviewInDays: -5,
    items: [
      { hazard: "Collapse of unsupported sides", likelihood: 3, severity: 5, residual: [1, 5] },
      { hazard: "Strike on buried services", likelihood: 3, severity: 5, residual: [1, 5] },
      { hazard: "Plant falling into the excavation", likelihood: 2, severity: 5, residual: [1, 5] },
      { hazard: "Water ingress and unstable ground", likelihood: 3, severity: 3, residual: [2, 3] },
    ],
  },
  {
    id: "hse_ra_003", number: "RA-2026-0003", title: "Hot work — welding and cutting", activity: "Hot work", status: "APPROVED", project: "a", owner: "hse", daysAgo: 70, reviewInDays: 60,
    items: [
      { hazard: "Fire from sparks reaching combustibles", likelihood: 3, severity: 5, residual: [1, 5] },
      { hazard: "Burns to the operative", likelihood: 3, severity: 3, residual: [1, 3] },
      { hazard: "Fume inhalation", likelihood: 3, severity: 3, residual: [1, 3] },
    ],
  },
  {
    id: "hse_ra_004", number: "RA-2026-0004", title: "Confined space entry", activity: "Riser and tank entry", status: "APPROVED", project: "a", owner: "hse", daysAgo: 60, reviewInDays: -2,
    items: [
      { hazard: "Oxygen deficiency", likelihood: 2, severity: 5, residual: [1, 5] },
      { hazard: "Toxic atmosphere from coatings", likelihood: 3, severity: 5, residual: [1, 5] },
      { hazard: "Difficulty of rescue", likelihood: 2, severity: 5, residual: [1, 5] },
    ],
  },
  {
    id: "hse_ra_005", number: "RA-2026-0005", title: "Scaffold erection and dismantling", activity: "Scaffolding", status: "APPROVED", project: "b", owner: "hse", daysAgo: 55, reviewInDays: 90,
    items: [
      { hazard: "Falls during erection", likelihood: 3, severity: 5, residual: [1, 5] },
      { hazard: "Falling components", likelihood: 3, severity: 4, residual: [1, 4] },
    ],
  },
  {
    id: "hse_ra_006", number: "RA-2026-0006", title: "Temporary electrical distribution", activity: "Electrical", status: "APPROVED", project: "c", owner: "engineer", daysAgo: 50, reviewInDays: 120,
    items: [
      { hazard: "Electric shock from damaged equipment", likelihood: 3, severity: 5, residual: [1, 5] },
      { hazard: "Fire from overloaded circuits", likelihood: 2, severity: 4, residual: [1, 4] },
    ],
  },
  {
    id: "hse_ra_007", number: "RA-2026-0007", title: "Manual handling of kerbs and slabs", activity: "External works", status: "APPROVED", project: "c", owner: "engineer", daysAgo: 45, reviewInDays: 150,
    items: [
      { hazard: "Back injury from repeated lifting", likelihood: 4, severity: 2, residual: [2, 2] },
      { hazard: "Crush injury to hands and feet", likelihood: 3, severity: 3, residual: [1, 3] },
    ],
  },
  {
    id: "hse_ra_008", number: "RA-2026-0008", title: "Working over water", activity: "Riverside works", status: "PENDING_APPROVAL", project: "b", owner: "hse", daysAgo: 10,
    items: [
      { hazard: "Drowning after a fall", likelihood: 2, severity: 5, residual: [1, 5] },
      { hazard: "Cold water shock", likelihood: 2, severity: 4 },
    ],
  },
  {
    id: "hse_ra_009", number: "RA-2026-0009", title: "Demolition of internal walls", activity: "Strip-out", status: "PENDING_APPROVAL", project: "d", owner: "pm", daysAgo: 6,
    items: [
      { hazard: "Uncontrolled collapse", likelihood: 2, severity: 5 },
      { hazard: "Dust and silica exposure", likelihood: 4, severity: 3, residual: [2, 3] },
      { hazard: "Disturbing asbestos-containing material", likelihood: 2, severity: 5, residual: [1, 5] },
    ],
  },
  {
    id: "hse_ra_010", number: "RA-2026-0010", title: "Roof waterproofing", activity: "Roofing", status: "DRAFT", project: "a", owner: "hse", daysAgo: 3,
    items: [
      { hazard: "Fall from the roof edge", likelihood: 3, severity: 5 },
      { hazard: "Fall through a fragile roof light", likelihood: 2, severity: 5 },
    ],
  },
  {
    id: "hse_ra_011", number: "RA-2026-0011", title: "Site traffic management", activity: "Logistics", status: "DRAFT", project: "e", owner: "pm", daysAgo: 2,
    items: [{ hazard: "Pedestrian struck by plant", likelihood: 3, severity: 5 }],
  },
  {
    /* Superseded by a later version, so the versioning rule is visible (§112). */
    id: "hse_ra_012", number: "RA-2026-0004", version: 1, title: "Confined space entry (superseded)", activity: "Riser entry", status: "ARCHIVED", project: "a", owner: "hse", daysAgo: 200,
    items: [{ hazard: "Oxygen deficiency", likelihood: 3, severity: 5 }],
  },
];

async function seedRiskAssessments(prisma: PrismaClient, people: Record<string, string>) {
  for (const fixture of ASSESSMENTS) {
    const approved = fixture.status === "APPROVED" || fixture.status === "ARCHIVED";

    await prisma.hseRiskAssessment.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        assessmentNumber: fixture.number,
        title: fixture.title,
        description: `Risk assessment for ${fixture.activity.toLowerCase()} on this project.`,
        projectId: fixture.project ? PROJECT_IDS[fixture.project] : null,
        activityType: fixture.activity,
        locationText: "As described in the method statement",
        version: fixture.version ?? (fixture.id === "hse_ra_004" ? 2 : 1),
        status: fixture.status,
        ownerMemberId: people[fixture.owner]!,
        assessmentDate: daysFromNow(-fixture.daysAgo),
        reviewDate: fixture.reviewInDays === undefined ? null : daysFromNow(fixture.reviewInDays),
        submittedAt: fixture.status === "DRAFT" ? null : daysFromNow(-fixture.daysAgo + 1),
        approvedAt: approved ? daysFromNow(-fixture.daysAgo + 2) : null,
        approvedByMemberId: approved ? people.owner! : null,
        archivedAt: fixture.status === "ARCHIVED" ? daysFromNow(-fixture.daysAgo + 10) : null,
        createdByMemberId: people[fixture.owner]!,
      },
    });

    const existing = await prisma.hseRiskAssessmentItem.count({
      where: { riskAssessmentId: fixture.id },
    });
    if (existing > 0) continue;

    await prisma.hseRiskAssessmentItem.createMany({
      data: fixture.items.map((item, index) => {
        const risk = riskOf(item.likelihood, item.severity);
        const residual = item.residual ? riskOf(item.residual[0], item.residual[1]) : null;

        return {
          riskAssessmentId: fixture.id,
          hazardDescription: item.hazard,
          existingControls: "Method statement, competent supervision, induction and briefing.",
          likelihood: risk.likelihood,
          severityScore: risk.severityScore,
          riskScore: risk.riskScore,
          riskLevel: risk.riskLevel,
          additionalControls: residual
            ? "Physical control installed, permit required, and a daily check before work starts."
            : null,
          residualLikelihood: residual?.likelihood ?? null,
          residualSeverity: residual?.severityScore ?? null,
          residualRiskScore: residual?.riskScore ?? null,
          residualRiskLevel: residual?.riskLevel ?? null,
          responsibleMemberId: people[fixture.owner]!,
          dueDate: null,
          sortOrder: index,
        };
      }),
    });
  }

  return ASSESSMENTS;
}

/* -------------------------------------------------------------------------- */
/* Work permits                                                                */
/* -------------------------------------------------------------------------- */

type PermitFixture = {
  id: string;
  number: string;
  type: string;
  title: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CLOSED" | "CANCELLED";
  project: keyof typeof PROJECT_IDS;
  requester: "hse" | "pm" | "engineer";
  responsible?: "hse" | "pm" | "engineer";
  /** Hours from now; negative is in the past. */
  from: number;
  until: number;
  assessment?: string;
  location: string;
};

const PERMITS: PermitFixture[] = [
  { id: "hse_ptw_001", number: "PTW-2026-0001", type: "HOT_WORK", title: "Welding to level 4 steel", status: "ACTIVE", project: "a", requester: "pm", responsible: "hse", from: -2, until: 6, assessment: "hse_ra_003", location: "Level 4 east" },
  { id: "hse_ptw_002", number: "PTW-2026-0002", type: "CONFINED_SPACE", title: "Coating the east riser", status: "ACTIVE", project: "a", requester: "hse", responsible: "hse", from: -1, until: 10, assessment: "hse_ra_004", location: "East riser, level 2" },
  { id: "hse_ptw_003", number: "PTW-2026-0003", type: "EXCAVATION", title: "Drainage run 3", status: "ACTIVE", project: "c", requester: "engineer", responsible: "engineer", from: -4, until: 30, assessment: "hse_ra_002", location: "Drainage run 3" },
  /*
   * Stored ACTIVE with a window that closed yesterday. This is the only way to
   * see §151 working without waiting for a permit to lapse.
   */
  { id: "hse_ptw_004", number: "PTW-2026-0004", type: "WORK_AT_HEIGHT", title: "Scaffold alteration bay 4", status: "ACTIVE", project: "b", requester: "hse", responsible: "pm", from: -30, until: -6, assessment: "hse_ra_005", location: "Scaffold bay 4" },
  { id: "hse_ptw_005", number: "PTW-2026-0005", type: "ELECTRICAL", title: "Live testing of the temporary board", status: "SUSPENDED", project: "c", requester: "engineer", responsible: "engineer", from: -12, until: 24, assessment: "hse_ra_006", location: "Temporary supply" },
  { id: "hse_ptw_006", number: "PTW-2026-0006", type: "LIFTING", title: "Plant lift to level 5", status: "APPROVED", project: "a", requester: "pm", responsible: "hse", from: 12, until: 36, location: "Tower crane" },
  { id: "hse_ptw_007", number: "PTW-2026-0007", type: "HOT_WORK", title: "Pipe brazing in the plant room", status: "PENDING_APPROVAL", project: "a", requester: "engineer", responsible: "engineer", from: 24, until: 48, assessment: "hse_ra_003", location: "Basement plant room" },
  { id: "hse_ptw_008", number: "PTW-2026-0008", type: "CONFINED_SPACE", title: "Tank inspection", status: "PENDING_APPROVAL", project: "b", requester: "hse", responsible: "hse", from: 36, until: 60, assessment: "hse_ra_004", location: "Attenuation tank" },
  { id: "hse_ptw_009", number: "PTW-2026-0009", type: "GENERAL", title: "Out-of-hours delivery", status: "DRAFT", project: "d", requester: "pm", from: 48, until: 72, location: "Main gate" },
  { id: "hse_ptw_010", number: "PTW-2026-0010", type: "EXCAVATION", title: "Trial holes", status: "CLOSED", project: "c", requester: "engineer", responsible: "engineer", from: -240, until: -216, assessment: "hse_ra_002", location: "North boundary" },
  { id: "hse_ptw_011", number: "PTW-2026-0011", type: "WORK_AT_HEIGHT", title: "Roof edge survey", status: "CLOSED", project: "a", requester: "hse", responsible: "hse", from: -190, until: -180, location: "Roof" },
  { id: "hse_ptw_012", number: "PTW-2026-0012", type: "OTHER", title: "Cancelled — superseded by PTW-2026-0006", status: "CANCELLED", project: "a", requester: "pm", from: 12, until: 36, location: "Tower crane" },
];

async function seedPermits(
  prisma: PrismaClient,
  people: Record<string, string>,
  assessments: AssessmentFixture[],
) {
  const known = new Set(assessments.map((assessment) => assessment.id));

  for (const fixture of PERMITS) {
    const decided = ["APPROVED", "ACTIVE", "SUSPENDED", "EXPIRED", "CLOSED"].includes(fixture.status);
    const activated = ["ACTIVE", "SUSPENDED", "EXPIRED", "CLOSED"].includes(fixture.status);

    await prisma.hseWorkPermit.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        permitNumber: fixture.number,
        permitType: fixture.type as never,
        title: fixture.title,
        projectId: PROJECT_IDS[fixture.project],
        locationText: fixture.location,
        riskAssessmentId:
          fixture.assessment && known.has(fixture.assessment) ? fixture.assessment : null,
        validFrom: hoursFromNow(fixture.from),
        validUntil: hoursFromNow(fixture.until),
        requestedByMemberId: people[fixture.requester]!,
        responsibleMemberId: fixture.responsible ? people[fixture.responsible]! : null,
        status: fixture.status,
        hazardsSummary: "As set out in the risk assessment cited above.",
        controlsSummary:
          "Area isolated, exclusion zone in place, competent supervision throughout.",
        ppeRequirements: "Helmet, high-visibility, gloves, eye protection, boots.",
        specialConditions:
          fixture.type === "HOT_WORK"
            ? "Fire watch for one hour after work ends. Extinguisher within 5 metres."
            : fixture.type === "CONFINED_SPACE"
              ? "Gas test before entry and every 30 minutes. Rescue plan and standby person."
              : null,
        suspensionReason:
          fixture.status === "SUSPENDED"
            ? "Suspended while the RCD fault on the temporary board is investigated."
            : null,
        submittedAt: fixture.status === "DRAFT" ? null : hoursFromNow(fixture.from - 24),
        approvedAt: decided ? hoursFromNow(fixture.from - 12) : null,
        approvedByMemberId: decided ? people.owner! : null,
        activatedAt: activated ? hoursFromNow(fixture.from) : null,
        suspendedAt: fixture.status === "SUSPENDED" ? hoursFromNow(-2) : null,
        closedAt: fixture.status === "CLOSED" ? hoursFromNow(fixture.until + 1) : null,
        closedByMemberId: fixture.status === "CLOSED" ? people.hse! : null,
        cancelledAt: fixture.status === "CANCELLED" ? hoursFromNow(-48) : null,
        createdByMemberId: people[fixture.requester]!,
      },
    });
  }

  return PERMITS;
}

/* -------------------------------------------------------------------------- */
/* Environmental observations                                                  */
/* -------------------------------------------------------------------------- */

type ObservationFixture = {
  id: string;
  number: string;
  category: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "PENDING_VERIFICATION" | "CLOSED" | "CANCELLED" | "REOPENED";
  project: keyof typeof PROJECT_IDS | null;
  reporter: "hse" | "pm" | "engineer";
  assignee?: "hse" | "pm" | "engineer";
  daysAgo: number;
};

const OBSERVATIONS: ObservationFixture[] = [
  { id: "hse_env_001", number: "ENV-2026-0001", category: "SPILL", title: "Diesel spill at the fuel point", severity: "HIGH", status: "CLOSED", project: "c", reporter: "hse", assignee: "engineer", daysAgo: 40 },
  { id: "hse_env_002", number: "ENV-2026-0002", category: "SPILL", title: "Hydraulic oil under a parked excavator", severity: "MEDIUM", status: "CLOSED", project: "c", reporter: "engineer", assignee: "engineer", daysAgo: 34 },
  { id: "hse_env_003", number: "ENV-2026-0003", category: "WASTE", title: "Mixed waste in the inert skip", severity: "LOW", status: "CLOSED", project: "a", reporter: "pm", assignee: "pm", daysAgo: 28 },
  { id: "hse_env_004", number: "ENV-2026-0004", category: "WASTE", title: "Packaging blowing off site", severity: "MEDIUM", status: "IN_PROGRESS", project: "b", reporter: "pm", assignee: "pm", daysAgo: 9 },
  { id: "hse_env_005", number: "ENV-2026-0005", category: "DUST", title: "Visible dust plume from cutting", severity: "MEDIUM", status: "OPEN", project: "b", reporter: "engineer", assignee: "hse", daysAgo: 5 },
  { id: "hse_env_006", number: "ENV-2026-0006", category: "DUST", title: "Haul road generating dust in dry weather", severity: "LOW", status: "CLOSED", project: "c", reporter: "engineer", assignee: "engineer", daysAgo: 24 },
  { id: "hse_env_007", number: "ENV-2026-0007", category: "NOISE", title: "Breaking outside permitted hours", severity: "HIGH", status: "CLOSED", project: "a", reporter: "hse", assignee: "pm", daysAgo: 20 },
  { id: "hse_env_008", number: "ENV-2026-0008", category: "NOISE", title: "Generator running overnight", severity: "MEDIUM", status: "PENDING_VERIFICATION", project: "d", reporter: "pm", assignee: "pm", daysAgo: 12 },
  { id: "hse_env_009", number: "ENV-2026-0009", category: "WATER", title: "Silty water reaching the surface drain", severity: "HIGH", status: "IN_PROGRESS", project: "c", reporter: "hse", assignee: "engineer", daysAgo: 16 },
  { id: "hse_env_010", number: "ENV-2026-0010", category: "WATER", title: "Concrete wash-out close to a watercourse", severity: "CRITICAL", status: "CLOSED", project: "c", reporter: "hse", assignee: "hse", daysAgo: 30 },
  { id: "hse_env_011", number: "ENV-2026-0011", category: "SOIL", title: "Stained ground near the plant store", severity: "MEDIUM", status: "OPEN", project: "c", reporter: "engineer", assignee: "hse", daysAgo: 4 },
  { id: "hse_env_012", number: "ENV-2026-0012", category: "EMISSIONS", title: "Plant left idling for long periods", severity: "LOW", status: "CLOSED", project: "a", reporter: "pm", assignee: "pm", daysAgo: 18 },
  { id: "hse_env_013", number: "ENV-2026-0013", category: "BIODIVERSITY", title: "Nesting birds found in scrub to be cleared", severity: "HIGH", status: "REOPENED", project: "e", reporter: "hse", assignee: "hse", daysAgo: 22 },
  { id: "hse_env_014", number: "ENV-2026-0014", category: "OTHER", title: "Mud tracked onto the public road", severity: "MEDIUM", status: "OPEN", project: "c", reporter: "pm", assignee: "pm", daysAgo: 2 },
];

async function seedEnvironmental(prisma: PrismaClient, people: Record<string, string>) {
  for (const fixture of OBSERVATIONS) {
    const closed = fixture.status === "CLOSED";

    await prisma.environmentalObservation.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        observationNumber: fixture.number,
        projectId: fixture.project ? PROJECT_IDS[fixture.project] : null,
        category: fixture.category as never,
        title: fixture.title,
        description: `${fixture.title}. Seen on a routine walk and recorded here.`,
        observedAt: daysFromNow(-fixture.daysAgo),
        locationText: "On site",
        severity: fixture.severity,
        status: fixture.status,
        reportedByMemberId: people[fixture.reporter]!,
        assignedToMemberId: fixture.assignee ? people[fixture.assignee]! : null,
        immediateAction:
          fixture.category === "SPILL"
            ? "Spill kit deployed and the source isolated."
            : "Work paused in the area while it was dealt with.",
        dueDate: closed ? null : daysFromNow(fixture.daysAgo > 10 ? -1 : 7),
        closedAt: closed ? daysFromNow(-fixture.daysAgo + 4) : null,
        closedByMemberId: closed ? people.hse! : null,
        closureNote: closed ? "Cleaned up, controls put in place and verified." : null,
        createdByMemberId: people[fixture.reporter]!,
      },
    });
  }

  return OBSERVATIONS;
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

type StopWorkFixture = {
  id: string;
  number: string;
  title: string;
  status: "ACTIVE" | "RELEASED" | "CANCELLED";
  project: keyof typeof PROJECT_IDS;
  issuer: "hse" | "pm" | "engineer";
  daysAgo: number;
  hazard?: string;
  incident?: string;
};

const STOP_WORKS: StopWorkFixture[] = [
  /*
   * Active, with a critical action against it that is not yet verified — the
   * only way to see the release rule working without breaking one (§174).
   */
  { id: "hse_sw_001", number: "SW-2026-0001", title: "All work on level 5 west", status: "ACTIVE", project: "a", issuer: "hse", daysAgo: 0, hazard: "hse_hz_035" },
  { id: "hse_sw_002", number: "SW-2026-0002", title: "Riser coating stopped", status: "ACTIVE", project: "a", issuer: "hse", daysAgo: 20, incident: "hse_inc_010" },
  { id: "hse_sw_003", number: "SW-2026-0003", title: "Excavation work halted", status: "RELEASED", project: "c", issuer: "engineer", daysAgo: 18, hazard: "hse_hz_006" },
  { id: "hse_sw_004", number: "SW-2026-0004", title: "Ladder access to level 2 stopped", status: "RELEASED", project: "b", issuer: "hse", daysAgo: 52, incident: "hse_inc_004" },
  { id: "hse_sw_005", number: "SW-2026-0005", title: "Issued in error — duplicate", status: "CANCELLED", project: "a", issuer: "pm", daysAgo: 15 },
];

async function seedStopWork(
  prisma: PrismaClient,
  people: Record<string, string>,
  hazards: HazardFixture[],
  incidents: IncidentFixture[],
) {
  const knownHazards = new Set(hazards.map((hazard) => hazard.id));
  const knownIncidents = new Set(incidents.map((incident) => incident.id));

  for (const fixture of STOP_WORKS) {
    const released = fixture.status === "RELEASED";

    await prisma.stopWorkRecord.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        stopWorkNumber: fixture.number,
        projectId: PROJECT_IDS[fixture.project],
        title: fixture.title,
        reason:
          "Conditions were not safe to continue. Work stops until the control is in and verified.",
        locationText: "As described on the linked record",
        hazardId: fixture.hazard && knownHazards.has(fixture.hazard) ? fixture.hazard : null,
        incidentId:
          fixture.incident && knownIncidents.has(fixture.incident) ? fixture.incident : null,
        issuedAt: daysFromNow(-fixture.daysAgo),
        issuedByMemberId: people[fixture.issuer]!,
        status: fixture.status,
        releasedAt: released ? daysFromNow(-fixture.daysAgo + 2) : null,
        releasedByMemberId: released ? people.hse! : null,
        releaseReason: released
          ? "Control installed and verified by somebody other than whoever fitted it."
          : null,
        cancelledAt: fixture.status === "CANCELLED" ? daysFromNow(-fixture.daysAgo) : null,
        createdByMemberId: people[fixture.issuer]!,
      },
    });
  }

  return STOP_WORKS;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

type ActionFixture = {
  id: string;
  number: string;
  title: string;
  type: "CORRECTIVE" | "PREVENTIVE" | "IMMEDIATE" | "FOLLOW_UP" | "OTHER";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED" | "CANCELLED" | "REOPENED";
  assignee: "hse" | "pm" | "engineer";
  /** Whoever recorded the work — never the same person who verifies it (§122). */
  completedBy?: "hse" | "pm" | "engineer";
  verifiedBy?: "hse" | "owner";
  daysAgo: number;
  parent: { kind: string; id: string };
  overdue?: boolean;
};

const ACTIONS: ActionFixture[] = [
  { id: "hse_act_001", number: "HSE-ACT-2026-0001", title: "Install edge protection to level 4 east", type: "CORRECTIVE", priority: "CRITICAL", status: "VERIFIED", assignee: "pm", completedBy: "pm", verifiedBy: "hse", daysAgo: 54, parent: { kind: "hazardId", id: "hse_hz_001" } },
  { id: "hse_act_002", number: "HSE-ACT-2026-0002", title: "Fit and secure the riser cover", type: "CORRECTIVE", priority: "CRITICAL", status: "PENDING_VERIFICATION", assignee: "pm", completedBy: "pm", daysAgo: 2, parent: { kind: "hazardId", id: "hse_hz_002" } },
  { id: "hse_act_003", number: "HSE-ACT-2026-0003", title: "Lock the basement distribution board", type: "CORRECTIVE", priority: "HIGH", status: "VERIFIED", assignee: "engineer", completedBy: "engineer", verifiedBy: "hse", daysAgo: 39, parent: { kind: "hazardId", id: "hse_hz_003" } },
  { id: "hse_act_004", number: "HSE-ACT-2026-0004", title: "Clear the level 2 escape route", type: "IMMEDIATE", priority: "CRITICAL", status: "IN_PROGRESS", assignee: "pm", daysAgo: 6, parent: { kind: "hazardId", id: "hse_hz_004" }, overdue: true },
  { id: "hse_act_005", number: "HSE-ACT-2026-0005", title: "Replace the out-of-date extinguisher", type: "CORRECTIVE", priority: "MEDIUM", status: "OPEN", assignee: "hse", daysAgo: 6, parent: { kind: "hazardId", id: "hse_hz_005" } },
  { id: "hse_act_006", number: "HSE-ACT-2026-0006", title: "Batter or support the trench sides", type: "CORRECTIVE", priority: "CRITICAL", status: "VERIFIED", assignee: "engineer", completedBy: "engineer", verifiedBy: "hse", daysAgo: 17, parent: { kind: "hazardId", id: "hse_hz_006" } },
  { id: "hse_act_007", number: "HSE-ACT-2026-0007", title: "Re-mark buried services and record it", type: "CORRECTIVE", priority: "CRITICAL", status: "PENDING_VERIFICATION", assignee: "engineer", completedBy: "engineer", daysAgo: 16, parent: { kind: "hazardId", id: "hse_hz_007" } },
  { id: "hse_act_008", number: "HSE-ACT-2026-0008", title: "Quarantine uncertified lifting accessories", type: "IMMEDIATE", priority: "CRITICAL", status: "VERIFIED", assignee: "pm", completedBy: "pm", verifiedBy: "hse", daysAgo: 29, parent: { kind: "hazardId", id: "hse_hz_008" } },
  { id: "hse_act_009", number: "HSE-ACT-2026-0009", title: "Route leads overhead on level 4", type: "CORRECTIVE", priority: "MEDIUM", status: "VERIFIED", assignee: "pm", completedBy: "pm", verifiedBy: "hse", daysAgo: 13, parent: { kind: "hazardId", id: "hse_hz_009" } },
  { id: "hse_act_010", number: "HSE-ACT-2026-0010", title: "Restack plasterboard off the walkway", type: "CORRECTIVE", priority: "MEDIUM", status: "OPEN", assignee: "pm", daysAgo: 3, parent: { kind: "hazardId", id: "hse_hz_010" } },
  { id: "hse_act_011", number: "HSE-ACT-2026-0011", title: "Re-brief the gate team on helmet rules", type: "PREVENTIVE", priority: "HIGH", status: "VERIFIED", assignee: "hse", completedBy: "hse", verifiedBy: "owner", daysAgo: 37, parent: { kind: "hazardId", id: "hse_hz_011" } },
  { id: "hse_act_012", number: "HSE-ACT-2026-0012", title: "Tag and log every harness on site", type: "CORRECTIVE", priority: "CRITICAL", status: "IN_PROGRESS", assignee: "hse", daysAgo: 37, parent: { kind: "hazardId", id: "hse_hz_012" }, overdue: true },
  { id: "hse_act_013", number: "HSE-ACT-2026-0013", title: "Move the fuel drum into the bund", type: "CORRECTIVE", priority: "MEDIUM", status: "VERIFIED", assignee: "engineer", completedBy: "engineer", verifiedBy: "hse", daysAgo: 24, parent: { kind: "hazardId", id: "hse_hz_013" } },
  { id: "hse_act_014", number: "HSE-ACT-2026-0014", title: "Set up dust suppression for cutting", type: "CORRECTIVE", priority: "HIGH", status: "OPEN", assignee: "pm", daysAgo: 5, parent: { kind: "hazardId", id: "hse_hz_014" } },
  { id: "hse_act_015", number: "HSE-ACT-2026-0015", title: "Appoint a banksman for the entrance", type: "CORRECTIVE", priority: "HIGH", status: "VERIFIED", assignee: "pm", completedBy: "pm", verifiedBy: "hse", daysAgo: 19, parent: { kind: "hazardId", id: "hse_hz_015" } },
  { id: "hse_act_016", number: "HSE-ACT-2026-0016", title: "Segregate pedestrians in the material yard", type: "CORRECTIVE", priority: "HIGH", status: "IN_PROGRESS", assignee: "pm", daysAgo: 9, parent: { kind: "hazardId", id: "hse_hz_016" } },
  { id: "hse_act_017", number: "HSE-ACT-2026-0017", title: "Refit and lock the bench saw guard", type: "CORRECTIVE", priority: "CRITICAL", status: "VERIFIED", assignee: "engineer", completedBy: "engineer", verifiedBy: "hse", daysAgo: 32, parent: { kind: "hazardId", id: "hse_hz_017" } },
  { id: "hse_act_018", number: "HSE-ACT-2026-0018", title: "Replace the damaged compressor hose", type: "CORRECTIVE", priority: "MEDIUM", status: "PENDING_VERIFICATION", assignee: "engineer", completedBy: "engineer", daysAgo: 10, parent: { kind: "hazardId", id: "hse_hz_018" } },
  { id: "hse_act_019", number: "HSE-ACT-2026-0019", title: "Label every chemical container in the store", type: "CORRECTIVE", priority: "HIGH", status: "OPEN", assignee: "hse", daysAgo: 7, parent: { kind: "hazardId", id: "hse_hz_019" } },
  { id: "hse_act_020", number: "HSE-ACT-2026-0020", title: "Relocate solvent storage away from hot work", type: "CORRECTIVE", priority: "CRITICAL", status: "VERIFIED", assignee: "hse", completedBy: "hse", verifiedBy: "owner", daysAgo: 26, parent: { kind: "hazardId", id: "hse_hz_020" } },
  { id: "hse_act_021", number: "HSE-ACT-2026-0021", title: "Secure materials at height before wind", type: "IMMEDIATE", priority: "CRITICAL", status: "OPEN", assignee: "hse", daysAgo: 0, parent: { kind: "stopWorkId", id: "hse_sw_001" } },
  { id: "hse_act_022", number: "HSE-ACT-2026-0022", title: "Issue a confined-space permit before any riser work", type: "CORRECTIVE", priority: "CRITICAL", status: "PENDING_VERIFICATION", assignee: "hse", completedBy: "hse", daysAgo: 19, parent: { kind: "incidentId", id: "hse_inc_010" } },
  { id: "hse_act_023", number: "HSE-ACT-2026-0023", title: "Retrain operatives on saw guarding", type: "PREVENTIVE", priority: "HIGH", status: "VERIFIED", assignee: "hse", completedBy: "hse", verifiedBy: "owner", daysAgo: 27, parent: { kind: "incidentId", id: "hse_inc_009" } },
  { id: "hse_act_024", number: "HSE-ACT-2026-0024", title: "Reinstate the settlement tank before discharge", type: "CORRECTIVE", priority: "HIGH", status: "IN_PROGRESS", assignee: "engineer", daysAgo: 15, parent: { kind: "incidentId", id: "hse_inc_015" } },
  { id: "hse_act_025", number: "HSE-ACT-2026-0025", title: "Introduce tag lines for all long loads", type: "PREVENTIVE", priority: "HIGH", status: "OPEN", assignee: "hse", daysAgo: 25, parent: { kind: "incidentId", id: "hse_nm_004" }, overdue: true },
  { id: "hse_act_026", number: "HSE-ACT-2026-0026", title: "Refresh the haul route after rain", type: "CORRECTIVE", priority: "MEDIUM", status: "REOPENED", assignee: "engineer", daysAgo: 43, parent: { kind: "incidentId", id: "hse_inc_016" } },
  { id: "hse_act_027", number: "HSE-ACT-2026-0027", title: "Fit anti-slip treads to the temporary stair", type: "CORRECTIVE", priority: "MEDIUM", status: "VERIFIED", assignee: "pm", completedBy: "pm", verifiedBy: "hse", daysAgo: 63, parent: { kind: "incidentId", id: "hse_inc_002" } },
  { id: "hse_act_028", number: "HSE-ACT-2026-0028", title: "Repair the debris netting", type: "CORRECTIVE", priority: "HIGH", status: "VERIFIED", assignee: "pm", completedBy: "pm", verifiedBy: "hse", daysAgo: 61, parent: { kind: "incidentId", id: "hse_nm_001" } },
  { id: "hse_act_029", number: "HSE-ACT-2026-0029", title: "Recover the failed fire checks", type: "CORRECTIVE", priority: "CRITICAL", status: "OPEN", assignee: "hse", daysAgo: 6, parent: { kind: "inspectionId", id: "hse_ins_006" } },
  { id: "hse_act_030", number: "HSE-ACT-2026-0030", title: "PAT test all portable equipment", type: "CORRECTIVE", priority: "HIGH", status: "PENDING_VERIFICATION", assignee: "engineer", completedBy: "engineer", daysAgo: 39, parent: { kind: "inspectionId", id: "hse_ins_004" } },
  { id: "hse_act_031", number: "HSE-ACT-2026-0031", title: "Tidy level 1 and keep routes clear", type: "CORRECTIVE", priority: "LOW", status: "VERIFIED", assignee: "pm", completedBy: "pm", verifiedBy: "hse", daysAgo: 2, parent: { kind: "inspectionId", id: "hse_ins_008" } },
  { id: "hse_act_032", number: "HSE-ACT-2026-0032", title: "Review the excavation method statement", type: "FOLLOW_UP", priority: "MEDIUM", status: "OPEN", assignee: "engineer", daysAgo: 5, parent: { kind: "riskAssessmentId", id: "hse_ra_002" } },
  { id: "hse_act_033", number: "HSE-ACT-2026-0033", title: "Bund the fuel point and stock the spill kit", type: "CORRECTIVE", priority: "HIGH", status: "VERIFIED", assignee: "engineer", completedBy: "engineer", verifiedBy: "hse", daysAgo: 39, parent: { kind: "environmentalObservationId", id: "hse_env_001" } },
  { id: "hse_act_034", number: "HSE-ACT-2026-0034", title: "Install a wheel wash at the exit", type: "CORRECTIVE", priority: "MEDIUM", status: "OPEN", assignee: "pm", daysAgo: 2, parent: { kind: "environmentalObservationId", id: "hse_env_014" } },
  { id: "hse_act_035", number: "HSE-ACT-2026-0035", title: "Withdrawn — covered by HSE-ACT-2026-0004", type: "OTHER", priority: "LOW", status: "CANCELLED", assignee: "pm", daysAgo: 6, parent: { kind: "hazardId", id: "hse_hz_004" } },
];

const PARENT_PROJECT: Record<string, keyof typeof PROJECT_IDS | null> = {};

async function seedActions(
  prisma: PrismaClient,
  people: Record<string, string>,
  sources: {
    hazards: HazardFixture[];
    incidents: IncidentFixture[];
    inspections: InspectionFixture[];
    assessments: AssessmentFixture[];
    observations: ObservationFixture[];
    stopWorks: StopWorkFixture[];
  },
) {
  // An action belongs to whatever site its parent does, so it turns up in that
  // project's list rather than nowhere (§239).
  for (const hazard of sources.hazards) PARENT_PROJECT[hazard.id] = hazard.project;
  for (const incident of sources.incidents) PARENT_PROJECT[incident.id] = incident.project;
  for (const inspection of sources.inspections) PARENT_PROJECT[inspection.id] = inspection.project;
  for (const assessment of sources.assessments) PARENT_PROJECT[assessment.id] = assessment.project;
  for (const observation of sources.observations) PARENT_PROJECT[observation.id] = observation.project;
  for (const stopWork of sources.stopWorks) PARENT_PROJECT[stopWork.id] = stopWork.project;

  for (const fixture of ACTIONS) {
    const project = PARENT_PROJECT[fixture.parent.id] ?? null;
    const completed = fixture.completedBy !== undefined;
    const verified = fixture.status === "VERIFIED";

    await prisma.hseAction.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        actionNumber: fixture.number,
        actionType: fixture.type,
        title: fixture.title,
        description: `${fixture.title}. Raised from the linked record and tracked to verification.`,
        projectId: project ? PROJECT_IDS[project] : null,
        [fixture.parent.kind]: fixture.parent.id,
        assignedToMemberId: people[fixture.assignee]!,
        dueDate: daysFromNow(fixture.overdue ? -3 : verified ? -1 : 7),
        priority: fixture.priority,
        status: fixture.status,
        completionNote: completed
          ? "Control installed and checked against the method statement."
          : null,
        completedAt: completed ? daysFromNow(-fixture.daysAgo + 2) : null,
        completedByMemberId: completed ? people[fixture.completedBy!]! : null,
        verificationNote: verified ? "Checked on site. The control is in and effective." : null,
        verifiedAt: verified ? daysFromNow(-fixture.daysAgo + 3) : null,
        verifiedByMemberId: verified ? people[fixture.verifiedBy ?? "hse"]! : null,
        cancelledAt: fixture.status === "CANCELLED" ? daysFromNow(-fixture.daysAgo) : null,
        createdByMemberId: people.hse!,
      },
    });
  }

  return ACTIONS.length;
}

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

const TOOLBOX: {
  id: string;
  number: string;
  title: string;
  topic: string;
  status: "DRAFT" | "COMPLETED" | "CANCELLED";
  project: keyof typeof PROJECT_IDS | null;
  conductor: "hse" | "pm" | "engineer";
  daysAgo: number;
  attendees: number;
  external: number;
  absent?: number;
}[] = [
  { id: "hse_tbt_001", number: "TBT-2026-0001", title: "Working at height", topic: "Working at height", status: "COMPLETED", project: "a", conductor: "hse", daysAgo: 56, attendees: 3, external: 2 },
  { id: "hse_tbt_002", number: "TBT-2026-0002", title: "Lifting operations", topic: "Lifting", status: "COMPLETED", project: "a", conductor: "hse", daysAgo: 49, attendees: 2, external: 3 },
  { id: "hse_tbt_003", number: "TBT-2026-0003", title: "PPE and why it matters", topic: "PPE", status: "COMPLETED", project: "b", conductor: "pm", daysAgo: 42, attendees: 3, external: 1, absent: 1 },
  { id: "hse_tbt_004", number: "TBT-2026-0004", title: "Housekeeping", topic: "Housekeeping", status: "COMPLETED", project: "a", conductor: "pm", daysAgo: 35, attendees: 2, external: 2 },
  { id: "hse_tbt_005", number: "TBT-2026-0005", title: "Electrical safety on site", topic: "Electrical safety", status: "COMPLETED", project: "c", conductor: "engineer", daysAgo: 28, attendees: 3, external: 1 },
  { id: "hse_tbt_006", number: "TBT-2026-0006", title: "Fire safety and escape routes", topic: "Fire safety", status: "COMPLETED", project: "a", conductor: "hse", daysAgo: 21, attendees: 3, external: 2 },
  { id: "hse_tbt_007", number: "TBT-2026-0007", title: "Excavation safety", topic: "Excavations", status: "COMPLETED", project: "c", conductor: "engineer", daysAgo: 18, attendees: 2, external: 2 },
  { id: "hse_tbt_008", number: "TBT-2026-0008", title: "Manual handling", topic: "Manual handling", status: "COMPLETED", project: "c", conductor: "engineer", daysAgo: 14, attendees: 2, external: 3 },
  { id: "hse_tbt_009", number: "TBT-2026-0009", title: "Dust and respiratory protection", topic: "Dust", status: "COMPLETED", project: "b", conductor: "hse", daysAgo: 11, attendees: 3, external: 1 },
  { id: "hse_tbt_010", number: "TBT-2026-0010", title: "Site traffic and pedestrians", topic: "Site traffic", status: "COMPLETED", project: "d", conductor: "pm", daysAgo: 8, attendees: 2, external: 2 },
  { id: "hse_tbt_011", number: "TBT-2026-0011", title: "Learning from the riser incident", topic: "Confined spaces", status: "COMPLETED", project: "a", conductor: "hse", daysAgo: 5, attendees: 3, external: 2 },
  { id: "hse_tbt_012", number: "TBT-2026-0012", title: "Near-miss reporting", topic: "Reporting", status: "COMPLETED", project: "a", conductor: "hse", daysAgo: 2, attendees: 3, external: 1 },
  { id: "hse_tbt_013", number: "TBT-2026-0013", title: "Winter working", topic: "Weather", status: "DRAFT", project: "b", conductor: "hse", daysAgo: 0, attendees: 2, external: 0 },
  { id: "hse_tbt_014", number: "TBT-2026-0014", title: "Cancelled — site closed", topic: "Housekeeping", status: "CANCELLED", project: "e", conductor: "pm", daysAgo: 7, attendees: 1, external: 0 },
];

const EXTERNAL_NAMES = [
  "R. Osborne (Groundworks Ltd)",
  "K. Petrov (Scaffold Co)",
  "M. Adeyemi (M&E subcontractor)",
];

async function seedToolbox(prisma: PrismaClient, people: Record<string, string>) {
  const roster = [people.hse!, people.pm!, people.engineer!];

  for (const fixture of TOOLBOX) {
    await prisma.toolboxTalk.upsert({
      where: { id: fixture.id },
      update: { status: fixture.status },
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        talkNumber: fixture.number,
        title: fixture.title,
        topic: fixture.topic,
        projectId: fixture.project ? PROJECT_IDS[fixture.project] : null,
        talkDate: daysFromNow(-fixture.daysAgo),
        locationText: "Site cabin",
        conductedByMemberId: people[fixture.conductor]!,
        status: fixture.status,
        notes: `Covered ${fixture.topic.toLowerCase()} and the recent findings on this site.`,
        completedAt: fixture.status === "COMPLETED" ? daysFromNow(-fixture.daysAgo) : null,
        cancelledAt: fixture.status === "CANCELLED" ? daysFromNow(-fixture.daysAgo) : null,
        createdByMemberId: people[fixture.conductor]!,
      },
    });

    const existing = await prisma.toolboxTalkParticipant.count({
      where: { toolboxTalkId: fixture.id },
    });
    if (existing > 0) continue;

    const rows: {
      toolboxTalkId: string;
      companyMemberId: string | null;
      externalName: string | null;
      attendanceStatus: "ATTENDED" | "ABSENT" | "EXCUSED";
      signatureRecorded: boolean;
    }[] = [];

    for (let index = 0; index < fixture.attendees; index += 1) {
      rows.push({
        toolboxTalkId: fixture.id,
        companyMemberId: roster[index % roster.length]!,
        externalName: null,
        attendanceStatus: "ATTENDED",
        signatureRecorded: fixture.status === "COMPLETED",
      });
    }

    // Subcontractors attend too, and are not members (§133).
    for (let index = 0; index < fixture.external; index += 1) {
      rows.push({
        toolboxTalkId: fixture.id,
        companyMemberId: null,
        externalName: EXTERNAL_NAMES[index % EXTERNAL_NAMES.length]!,
        attendanceStatus: "ATTENDED",
        signatureRecorded: fixture.status === "COMPLETED",
      });
    }

    for (let index = 0; index < (fixture.absent ?? 0); index += 1) {
      rows.push({
        toolboxTalkId: fixture.id,
        companyMemberId: null,
        externalName: "T. Novak (agency)",
        attendanceStatus: "ABSENT",
        signatureRecorded: false,
      });
    }

    await prisma.toolboxTalkParticipant.createMany({ data: rows });
  }

  return TOOLBOX.length;
}

/* -------------------------------------------------------------------------- */
/* PPE checks                                                                  */
/* -------------------------------------------------------------------------- */

async function seedPpe(prisma: PrismaClient, people: Record<string, string>) {
  const projects: (keyof typeof PROJECT_IDS)[] = ["a", "b", "c", "d"];
  const checkers = [people.hse!, people.pm!, people.engineer!];
  const subjects = [people.engineer!, people.pm!, null, null];

  for (let index = 0; index < 20; index += 1) {
    const id = `hse_ppe_${String(index + 1).padStart(3, "0")}`;
    // Every third check fails on one item; every seventh is a partial look.
    const fails = index % 3 === 2;
    const partial = index % 7 === 6;

    await prisma.ppeCheck.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        checkNumber: `PPE-2026-${String(index + 1).padStart(4, "0")}`,
        projectId: PROJECT_IDS[projects[index % projects.length]!],
        checkDate: daysFromNow(-(index * 2 + 1)),
        locationText: index % 2 === 0 ? "Site entrance" : "Level 2",
        checkedByMemberId: checkers[index % checkers.length]!,
        subjectMemberId: subjects[index % subjects.length],
        externalSubjectName:
          subjects[index % subjects.length] === null && index % 4 === 3
            ? EXTERNAL_NAMES[index % EXTERNAL_NAMES.length]!
            : null,
        helmetOk: fails && index % 6 === 2 ? false : true,
        eyeProtectionOk: partial ? null : fails && index % 6 === 5 ? false : true,
        hearingProtectionOk: partial ? null : true,
        respiratoryProtectionOk: partial ? null : index % 5 === 0 ? true : null,
        glovesOk: partial ? null : true,
        harnessOk: index % 4 === 0 ? true : null,
        footwearOk: partial ? null : true,
        otherPpeNote: index % 5 === 0 ? "Cut-resistant gloves issued for the task." : null,
        // Derived exactly as `ppeResultFor` does: any explicit no is a fail.
        result: fails && (index % 6 === 2 || index % 6 === 5) ? "FAIL" : "PASS",
        notes: fails ? "Operative sent to the stores and re-briefed before returning." : null,
        createdByMemberId: checkers[index % checkers.length]!,
      },
    });
  }

  return 20;
}

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

async function seedApprovals(
  prisma: PrismaClient,
  people: Record<string, string>,
  sources: {
    inspections: InspectionFixture[];
    assessments: AssessmentFixture[];
    permits: PermitFixture[];
    incidents: IncidentFixture[];
  },
) {
  type Row = {
    id: string;
    recordType: "INSPECTION" | "RISK_ASSESSMENT" | "WORK_PERMIT" | "INCIDENT_CLOSE";
    recordId: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    submittedBy: string;
    decidedBy?: string;
    daysAgo: number;
  };

  const rows: Row[] = [
    // Pending, submitted by the HSE officer — so the Owner sees a queue they can
    // act on and the officer sees one they cannot (§182).
    { id: "hse_ap_001", recordType: "INSPECTION", recordId: "hse_ins_006", status: "PENDING", submittedBy: people.hse!, daysAgo: 6 },
    { id: "hse_ap_002", recordType: "INSPECTION", recordId: "hse_ins_007", status: "PENDING", submittedBy: people.hse!, daysAgo: 4 },
    { id: "hse_ap_003", recordType: "INSPECTION", recordId: "hse_ins_008", status: "PENDING", submittedBy: people.pm!, daysAgo: 3 },
    { id: "hse_ap_004", recordType: "RISK_ASSESSMENT", recordId: "hse_ra_008", status: "PENDING", submittedBy: people.hse!, daysAgo: 9 },
    { id: "hse_ap_005", recordType: "RISK_ASSESSMENT", recordId: "hse_ra_009", status: "PENDING", submittedBy: people.pm!, daysAgo: 5 },
    { id: "hse_ap_006", recordType: "WORK_PERMIT", recordId: "hse_ptw_007", status: "PENDING", submittedBy: people.engineer!, daysAgo: 1 },
    { id: "hse_ap_007", recordType: "WORK_PERMIT", recordId: "hse_ptw_008", status: "PENDING", submittedBy: people.hse!, daysAgo: 1 },
    { id: "hse_ap_008", recordType: "INCIDENT_CLOSE", recordId: "hse_inc_009", status: "PENDING", submittedBy: people.hse!, daysAgo: 22 },
    { id: "hse_ap_009", recordType: "INCIDENT_CLOSE", recordId: "hse_nm_012", status: "PENDING", submittedBy: people.hse!, daysAgo: 8 },

    // Decided rows are kept, so the queue is also the record of who signed what.
    { id: "hse_ap_010", recordType: "INSPECTION", recordId: "hse_ins_004", status: "APPROVED", submittedBy: people.hse!, decidedBy: people.owner!, daysAgo: 39 },
    { id: "hse_ap_011", recordType: "INSPECTION", recordId: "hse_ins_009", status: "REJECTED", submittedBy: people.engineer!, decidedBy: people.owner!, daysAgo: 11 },
    { id: "hse_ap_012", recordType: "WORK_PERMIT", recordId: "hse_ptw_001", status: "APPROVED", submittedBy: people.pm!, decidedBy: people.owner!, daysAgo: 1 },
  ];

  const known = new Set<string>([
    ...sources.inspections.map((row) => row.id),
    ...sources.assessments.map((row) => row.id),
    ...sources.permits.map((row) => row.id),
    ...sources.incidents.map((row) => row.id),
  ]);

  for (const row of rows) {
    if (!known.has(row.recordId)) continue;

    await prisma.hseApproval.upsert({
      where: { id: row.id },
      update: { status: row.status },
      create: {
        id: row.id,
        companyId: COMPANY_A,
        recordType: row.recordType,
        recordId: row.recordId,
        status: row.status,
        submittedByMemberId: row.submittedBy,
        submittedAt: daysFromNow(-row.daysAgo),
        decidedByMemberId: row.decidedBy ?? null,
        decidedAt: row.decidedBy ? daysFromNow(-row.daysAgo + 1) : null,
        decisionNote:
          row.status === "REJECTED"
            ? "The welfare check was marked pass with no note — please walk it again."
            : row.status === "APPROVED"
              ? "Checked and signed off."
              : null,
      },
    });
  }

  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const DOCUMENTS: {
  id: string;
  name: string;
  entityType: string;
  entityId: string;
  project: keyof typeof PROJECT_IDS | null;
}[] = [
  { id: "hse_doc_001", name: "Level 4 edge protection — before.jpg", entityType: "hazard", entityId: "hse_hz_001", project: "a" },
  { id: "hse_doc_002", name: "Level 4 edge protection — after.jpg", entityType: "hazard", entityId: "hse_hz_001", project: "a" },
  { id: "hse_doc_003", name: "Blocked escape route.jpg", entityType: "hazard", entityId: "hse_hz_004", project: "a" },
  { id: "hse_doc_004", name: "Trench B — unsupported sides.jpg", entityType: "hazard", entityId: "hse_hz_006", project: "c" },
  { id: "hse_doc_005", name: "Fire safety walk — signed checklist.pdf", entityType: "hse_inspection", entityId: "hse_ins_006", project: "a" },
  { id: "hse_doc_006", name: "Work at height walk — signed checklist.pdf", entityType: "hse_inspection", entityId: "hse_ins_002", project: "a" },
  { id: "hse_doc_007", name: "Electrical inspection photos.pdf", entityType: "hse_inspection", entityId: "hse_ins_004", project: "a" },
  { id: "hse_doc_008", name: "Riser incident — investigation report.pdf", entityType: "incident", entityId: "hse_inc_010", project: "a" },
  { id: "hse_doc_009", name: "Ladder fall — investigation report.pdf", entityType: "incident", entityId: "hse_inc_004", project: "b" },
  { id: "hse_doc_010", name: "Saw incident — guard photographs.pdf", entityType: "incident", entityId: "hse_inc_009", project: "b" },
  { id: "hse_doc_011", name: "Steel erection risk assessment.pdf", entityType: "risk_assessment", entityId: "hse_ra_001", project: "a" },
  { id: "hse_doc_012", name: "Deep excavation risk assessment.pdf", entityType: "risk_assessment", entityId: "hse_ra_002", project: "c" },
  { id: "hse_doc_013", name: "Hot work risk assessment.pdf", entityType: "risk_assessment", entityId: "hse_ra_003", project: "a" },
  { id: "hse_doc_014", name: "Confined space risk assessment v2.pdf", entityType: "risk_assessment", entityId: "hse_ra_004", project: "a" },
  { id: "hse_doc_015", name: "Hot work permit — signed.pdf", entityType: "work_permit", entityId: "hse_ptw_001", project: "a" },
  { id: "hse_doc_016", name: "Confined space permit — signed.pdf", entityType: "work_permit", entityId: "hse_ptw_002", project: "a" },
  { id: "hse_doc_017", name: "Excavation permit — signed.pdf", entityType: "work_permit", entityId: "hse_ptw_003", project: "c" },
  { id: "hse_doc_018", name: "Method statement — drainage.pdf", entityType: "work_permit", entityId: "hse_ptw_003", project: "c" },
  { id: "hse_doc_019", name: "Working at height — attendance sheet.pdf", entityType: "toolbox_talk", entityId: "hse_tbt_001", project: "a" },
  { id: "hse_doc_020", name: "Lifting — attendance sheet.pdf", entityType: "toolbox_talk", entityId: "hse_tbt_002", project: "a" },
  { id: "hse_doc_021", name: "Confined spaces — attendance sheet.pdf", entityType: "toolbox_talk", entityId: "hse_tbt_011", project: "a" },
  { id: "hse_doc_022", name: "Diesel spill — cleanup evidence.jpg", entityType: "environmental_observation", entityId: "hse_env_001", project: "c" },
  { id: "hse_doc_023", name: "Wash-out area — remediation.pdf", entityType: "environmental_observation", entityId: "hse_env_010", project: "c" },
  { id: "hse_doc_024", name: "Waste transfer note.pdf", entityType: "environmental_observation", entityId: "hse_env_003", project: "a" },
  { id: "hse_doc_025", name: "Edge protection sign-off.pdf", entityType: "hse_action", entityId: "hse_act_001", project: "a" },
  { id: "hse_doc_026", name: "Harness register.xlsx", entityType: "hse_action", entityId: "hse_act_012", project: "a" },
];

async function seedHseDocuments(prisma: PrismaClient) {
  const uploader = await prisma.companyMember.findFirst({
    where: { companyId: COMPANY_A, user: { email: "hse@nesto.test" } },
    select: { id: true, userId: true },
  });
  if (!uploader) return;

  for (const doc of DOCUMENTS) {
    await seedStoredDocument(prisma, {
      id: doc.id,
      companyId: COMPANY_A,
      name: doc.name,
      projectId: doc.project ? PROJECT_IDS[doc.project] : null,
      module: "hse",
      entityType: doc.entityType,
      entityId: doc.entityId,
      uploadedByMemberId: uploader.id,
      createdBy: uploader.userId,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Company B                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A minimal independent set for Company B (PRD #22 §386).
 *
 * Its only job is to be something a Company A query must never return. Tenant
 * isolation cannot be proven against an empty second company.
 */
async function seedCompanyBHse(prisma: PrismaClient, members: Members) {
  const ownerB = members.get("user_owner_b");
  if (!ownerB) return;

  await prisma.hseHazard.upsert({
    where: { id: "hse_hz_b_001" },
    update: {},
    create: {
      id: "hse_hz_b_001",
      companyId: COMPANY_B,
      hazardNumber: "HZ-2026-0001",
      title: "Company B — unguarded stair opening",
      description: "Belongs to the other tenant. Company A must never see this row.",
      hazardCategory: "WORK_AT_HEIGHT",
      likelihood: 4,
      severityScore: 5,
      riskScore: 20,
      riskLevel: "CRITICAL",
      status: "OPEN",
      observedAt: daysFromNow(-3),
      reportedByMemberId: ownerB,
      immediateControl: "Opening barricaded.",
      createdByMemberId: ownerB,
    },
  });

  await prisma.hseIncident.upsert({
    where: { id: "hse_inc_b_001" },
    update: {},
    create: {
      id: "hse_inc_b_001",
      companyId: COMPANY_B,
      incidentNumber: "INC-2026-0001",
      incidentType: "NEAR_MISS",
      title: "Company B — near miss on the loading bay",
      description: "Belongs to the other tenant. Company A must never see this row.",
      occurredAt: daysFromNow(-5),
      reportedAt: daysFromNow(-5),
      severity: "MEDIUM",
      status: "OPEN",
      reportedByMemberId: ownerB,
      createdByMemberId: ownerB,
    },
  });
}
