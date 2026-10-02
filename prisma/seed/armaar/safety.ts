/**
 * Safety on ARMAAR's sites (D-02 §37, §68, §77).
 *
 * D-01 left one hazard (the unprotected slab edge on Tower A) and one near
 * miss (the dropped tie bar). D-02 adds a working month of the HSE module on
 * Tirana Lake, Farka Residence and The Courtyard, in the product's own states:
 *
 *   inspections   weekly site walks and a work-at-height inspection with their
 *                 checklists, one waiting for the HSE manager's approval, one
 *                 booked for next week
 *   observations  hazards from §37's examples — a blocked access route, PPE not
 *                 worn, scaffold tags out of date, housekeeping, an open trench
 *                 — each scored by the product's own 5×5 matrix
 *   actions       the corrective work each asks for, open to verified
 *   toolbox talks signed by the site workers without a login (E-04) as well as
 *                 by the supervisors who have one
 *   incidents     a first-aid case closed, property damage under investigation
 *   permits       hot work active on the podium roof, lifting waiting for
 *                 approval, a façade work-at-height permit closed
 *
 * Numbers continue D-01's series in the product's shape (HZ-2026-0032).
 * Every value is synthetic. Stable ids; a rerun adds nothing.
 */
import type { HseActionStatus, HseActionType, HseChecklistResult, HseHazardCategory, HseHazardStatus, HseInspectionResult, HseInspectionStatus, HseInspectionType, PrismaClient } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { assessRisk } from "../../../lib/modules/hse/hse.risk";
import { memberId } from "./access";
import { companyId } from "./organization";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";
import { workerEmploymentId } from "./workforce";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const ALN = "ARLIS_NDERTIM" as const;

/** Ids other files refer to (the daily log links its talk and inspection). */
export const SAFETY = { talkFacade: "armaar_tbt_tl_0051", inspectionWeek36: "armaar_hseins_tl_0041" } as const;

const CHECKLIST = [
  "Edge protection in place at every open slab edge",
  "Scaffolds tagged and inspected within seven days",
  "PPE worn in every work area",
  "Access routes and stairs clear",
  "Lifting exclusion zones barriered",
];

const INSPECTIONS: Array<{ id: string; company: CompanyCode; project: ProjectCode; number: string; type: HseInspectionType; title: string; inspector: string; approver: string; day: number; status: HseInspectionStatus; result: HseInspectionResult; failed?: number[]; location: string }> = [
  { id: SAFETY.inspectionWeek36, company: BCI, project: "TIRANA_LAKE", number: "HSE-INS-2026-0041", type: "SITE_SAFETY", title: "Weekly site safety inspection — week 36", inspector: "arlis.hse-officer", approver: "arlis.hse", day: -13, status: "CLOSED", result: "PASS", location: "Tirana Lake — Towers A and B" },
  { id: "armaar_hseins_tl_0043", company: BCI, project: "TIRANA_LAKE", number: "HSE-INS-2026-0043", type: "WORK_AT_HEIGHT", title: "Work at height — Tower B façade", inspector: "arlis.hse-officer", approver: "arlis.hse", day: -9, status: "CLOSED", result: "CONDITIONAL", failed: [1], location: "Tower B — east elevation" },
  { id: "armaar_hseins_tl_0045", company: BCI, project: "TIRANA_LAKE", number: "HSE-INS-2026-0045", type: "SITE_SAFETY", title: "Weekly site safety inspection — week 38", inspector: "arlis.hse-officer", approver: "arlis.hse", day: -1, status: "PENDING_APPROVAL", result: "CONDITIONAL", failed: [2, 3], location: "Tirana Lake — Towers A and B" },
  { id: "armaar_hseins_tl_0046", company: BCI, project: "TIRANA_LAKE", number: "HSE-INS-2026-0046", type: "LIFTING", title: "Lifting operations — tower crane TC-2", inspector: "arlis.hse", approver: "arlis.hse", day: 2, status: "SCHEDULED", result: "NOT_SET", location: "Tower B — crane base" },
];

const HAZARDS: Array<{ id: string; company: CompanyCode; project: ProjectCode; number: string; title: string; description: string; category: HseHazardCategory; likelihood: number; severity: number; status: HseHazardStatus; reporter: string; assignee: string; day: number; due: number; inspection?: string; control?: string; closure?: string; location: string }> = [
  { id: "armaar_hse_hz_tl_0032", company: BCI, project: "TIRANA_LAKE", number: "HZ-2026-0032", title: "Blocked access route — Tower A stair core", description: "Pallets of blockwork stacked across the level 6 stair landing.", category: "HOUSEKEEPING", likelihood: 3, severity: 3, status: "CONTROLLED", reporter: "arlis.site-supervisor", assignee: "arlis.site-supervisor", day: -7, due: -5, control: "Pallets moved to the loading bay; landing marked as a no-storage zone.", location: "Tower A — level 6 stair core" },
  { id: "armaar_hse_hz_tl_0033", company: BCI, project: "TIRANA_LAKE", number: "HZ-2026-0033", title: "PPE non-compliance — façade installers not clipped on", description: "Two installers on the Tower B mast climber were not clipped to the anchor line.", category: "PPE", likelihood: 3, severity: 4, status: "IN_PROGRESS", reporter: "arlis.hse-officer", assignee: "arlis.hse", day: -4, due: 3, control: "Work stopped on the platform until both were clipped on and re-briefed.", location: "Tower B — mast climber, east" },
  { id: "armaar_hse_hz_tl_0034", company: BCI, project: "TIRANA_LAKE", number: "HZ-2026-0034", title: "Scaffold tags out of date — Tower B east elevation", description: "Tags on bays 4 to 7 show the last inspection eleven days ago.", category: "WORK_AT_HEIGHT", likelihood: 3, severity: 4, status: "PENDING_VERIFICATION", reporter: "arlis.hse-officer", assignee: "arlis.site-supervisor", day: -9, due: -6, inspection: "armaar_hseins_tl_0043", control: "Bays 4 to 7 closed until inspected.", location: "Tower B — east elevation, bays 4 to 7" },
  { id: "armaar_hse_hz_tl_0035", company: BCI, project: "TIRANA_LAKE", number: "HZ-2026-0035", title: "Housekeeping — offcuts on Tower A level 9", description: "Timber and rebar offcuts left along the slab edge after the pour.", category: "HOUSEKEEPING", likelihood: 2, severity: 2, status: "CLOSED", reporter: "arlis.site-engineer", assignee: "arlis.site-supervisor", day: -15, due: -13, closure: "Level cleared; skip placed at the hoist landing.", location: "Tower A — level 9" },
];

const ACTIONS: Array<{ id: string; company: CompanyCode; project: ProjectCode; number: string; type: HseActionType; title: string; description: string; assignee: string; status: HseActionStatus; day: number; due: number; hazard?: string; incident?: string; inspection?: string }> = [
  { id: "armaar_hse_act_tl_0021", company: BCI, project: "TIRANA_LAKE", number: "HSE-ACT-2026-0021", type: "CORRECTIVE", title: "Re-inspect and re-tag the Tower B east scaffold", description: "Inspect bays 4 to 7, re-tag, and brief the scaffolders on the seven-day cycle.", assignee: "arlis.site-supervisor", status: "PENDING_VERIFICATION", day: -9, due: -6, hazard: "armaar_hse_hz_tl_0034", inspection: "armaar_hseins_tl_0043" },
  { id: "armaar_hse_act_tl_0022", company: BCI, project: "TIRANA_LAKE", number: "HSE-ACT-2026-0022", type: "CORRECTIVE", title: "Clip-on check at the façade hoist gate", description: "Supervisor checks every installer's harness and clip before the platform leaves the ground.", assignee: "arlis.hse", status: "IN_PROGRESS", day: -4, due: 3, hazard: "armaar_hse_hz_tl_0033" },
  { id: "armaar_hse_act_tl_0023", company: BCI, project: "TIRANA_LAKE", number: "HSE-ACT-2026-0023", type: "PREVENTIVE", title: "Replace the edge protection after every formwork strike", description: "Formwork foreman signs off the edge protection before the crew leaves a stripped level.", assignee: "arlis.site-supervisor", status: "OPEN", day: -1, due: 2, hazard: "armaar_hse_hz_001" },
  { id: "armaar_hse_act_tl_0024", company: BCI, project: "TIRANA_LAKE", number: "HSE-ACT-2026-0024", type: "CORRECTIVE", title: "Exclusion zone below the curtain-wall lifts", description: "Barrier and banksman below the lift path whenever the crane is lifting curtain-wall units.", assignee: "arlis.site-supervisor", status: "VERIFIED", day: -4, due: -2, incident: "armaar_hse_inc_001" },
];

/** Toolbox talks: E-04's site workers sign by their employment, supervisors by their login. */
const TALKS: Array<{ id: string; company: CompanyCode; project: ProjectCode; number: string; title: string; topic: string; by: string; day: number; completed: boolean; workers: string[]; logins: string[]; absent?: string[] }> = [
  { id: SAFETY.talkFacade, company: BCI, project: "TIRANA_LAKE", number: "TBT-2026-0051", title: "Working at height on the façade", topic: "Anchor lines, clipping on at the gate, and what to do if a colleague is not clipped on.", by: "arlis.hse-officer", day: -5, completed: true, workers: ["bci_08", "bci_09", "bci_10", "bci_11", "bci_12"], logins: ["arlis.site-supervisor"], absent: ["bci_14"] },
  { id: "armaar_tbt_tl_0052", company: BCI, project: "TIRANA_LAKE", number: "TBT-2026-0052", title: "Lifting and exclusion zones", topic: "Why the zone below a lift is closed, who holds the radio, and the dropped tie bar last week.", by: "arlis.hse", day: -3, completed: true, workers: ["bci_20", "bci_21", "bci_22", "bci_15", "bci_16"], logins: ["arlis.site-engineer"] },
  { id: "armaar_tbt_tl_0053", company: BCI, project: "TIRANA_LAKE", number: "TBT-2026-0053", title: "Hot works — torch-on membrane", topic: "Fire watch for an hour after the last torch, extinguishers at hand, the permit on the board.", by: "arlis.hse-officer", day: -12, completed: true, workers: ["bci_01", "bci_02", "bci_03"], logins: ["bci.engineering"] },
  { id: "armaar_tbt_tl_0054", company: BCI, project: "TIRANA_LAKE", number: "TBT-2026-0054", title: "Housekeeping and access routes", topic: "Keeping stairs and landings clear; where offcuts go.", by: "arlis.hse-officer", day: 1, completed: false, workers: [], logins: [] },
];

export async function seedArmaarSafety(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const m = (username: string, code: CompanyCode) => memberId(username, code);

  /* Inspections and their checklists (§37) ----------------------------------- */
  for (const inspection of INSPECTIONS) {
    const code = inspection.company;
    const inspector = m(inspection.inspector, code);
    const approver = m(inspection.approver, code);
    const executed = inspection.status !== "SCHEDULED";
    const closed = inspection.status === "CLOSED";
    await prisma.hseInspection.upsert({
      where: { id: inspection.id },
      update: {},
      create: {
        id: inspection.id,
        companyId: companyId(code),
        inspectionNumber: inspection.number,
        inspectionType: inspection.type,
        projectId: projectId(inspection.project),
        assignedInspectorMemberId: inspector,
        executedByMemberId: executed ? inspector : null,
        status: inspection.status,
        result: inspection.result,
        scheduledDate: day(inspection.day),
        inspectionDate: executed ? at(inspection.day, 9) : null,
        locationText: inspection.location,
        summary: executed ? (inspection.failed?.length ? `${inspection.title}: ${inspection.failed.length} item(s) need action.` : `${inspection.title}: all items satisfactory.`) : null,
        submittedAt: executed ? at(inspection.day, 12) : null,
        approvedAt: closed ? at(inspection.day + 1, 9) : null,
        approvedByMemberId: closed ? approver : null,
        closedAt: closed ? at(inspection.day + 1, 10) : null,
        closedByMemberId: closed ? approver : null,
        createdByMemberId: inspector,
        createdAt: at(inspection.day - 3, 9),
      },
    });
    if ((await prisma.hseInspectionChecklistItem.count({ where: { inspectionId: inspection.id } })) === 0) {
      await prisma.hseInspectionChecklistItem.createMany({
        data: CHECKLIST.map((label, index) => {
          const result: HseChecklistResult | null = executed ? (inspection.failed?.includes(index) ? "FAIL" : "PASS") : null;
          return { id: `${inspection.id}_item_${index + 1}`, inspectionId: inspection.id, code: `C${index + 1}`, label, responseType: "PASS_FAIL" as const, required: true, sortOrder: index, responseValue: result, result, note: result === "FAIL" ? "Raised as an observation and an action." : null, riskIfFailed: "HIGH" as const, requiresNoteOnFail: true };
        }),
      });
    }
    if (inspection.status === "PENDING_APPROVAL") {
      await prisma.hseApproval.upsert({ where: { id: `${inspection.id}_approval` }, update: {}, create: { id: `${inspection.id}_approval`, companyId: companyId(code), recordType: "INSPECTION", recordId: inspection.id, status: "PENDING", submittedByMemberId: inspector, submittedAt: at(inspection.day, 12) } });
    }
  }

  /* Observations: hazards scored on the product's matrix (§37) ---------------- */
  for (const hazard of HAZARDS) {
    const code = hazard.company;
    const risk = assessRisk(hazard.likelihood, hazard.severity);
    const closed = hazard.status === "CLOSED";
    const residual = closed ? assessRisk(1, hazard.severity) : null;
    await prisma.hseHazard.upsert({
      where: { id: hazard.id },
      update: {},
      create: {
        id: hazard.id,
        companyId: companyId(code),
        hazardNumber: hazard.number,
        title: hazard.title,
        description: hazard.description,
        projectId: projectId(hazard.project),
        inspectionId: hazard.inspection ?? null,
        hazardCategory: hazard.category,
        likelihood: hazard.likelihood,
        severityScore: hazard.severity,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        residualLikelihood: residual ? 1 : null,
        residualSeverity: residual ? hazard.severity : null,
        residualRiskScore: residual?.riskScore ?? null,
        residualRiskLevel: residual?.riskLevel ?? null,
        status: hazard.status,
        locationText: hazard.location,
        observedAt: at(hazard.day, 9),
        reportedByMemberId: m(hazard.reporter, code),
        assignedToMemberId: m(hazard.assignee, code),
        immediateControl: hazard.control ?? null,
        dueDate: day(hazard.due),
        closedAt: closed ? at(hazard.due, 15) : null,
        closedByMemberId: closed ? m("arlis.hse", code) : null,
        closureNote: hazard.closure ?? null,
        createdByMemberId: m(hazard.reporter, code),
        createdAt: at(hazard.day, 9),
      },
    });
  }

  /* Actions (§37: corrective actions) ------------------------------------------ */
  for (const action of ACTIONS) {
    const code = action.company;
    const assignee = m(action.assignee, code);
    // ARLIS - NDERTIM's HSE manager: on Tirana Lake for BCI, and on ARLIS's own sites.
    const verifier = m("arlis.hse", code);
    const completed = action.status === "PENDING_VERIFICATION" || action.status === "VERIFIED";
    await prisma.hseAction.upsert({
      where: { id: action.id },
      update: {},
      create: {
        id: action.id,
        companyId: companyId(code),
        actionNumber: action.number,
        actionType: action.type,
        title: action.title,
        description: action.description,
        projectId: projectId(action.project),
        hazardId: action.hazard ?? null,
        incidentId: action.incident ?? null,
        inspectionId: action.inspection ?? null,
        assignedToMemberId: assignee,
        dueDate: day(action.due),
        priority: "HIGH",
        status: action.status,
        completionNote: completed ? "Done and photographed; see the site diary." : null,
        completedAt: completed ? at(action.due - 1, 15) : null,
        completedByMemberId: completed ? assignee : null,
        verificationNote: action.status === "VERIFIED" ? "Checked on the next lift; the zone was barriered and manned." : null,
        verifiedAt: action.status === "VERIFIED" ? at(action.due, 10) : null,
        verifiedByMemberId: action.status === "VERIFIED" ? verifier : null,
        createdByMemberId: verifier,
        createdAt: at(action.day, 11),
      },
    });
  }

  /* Toolbox talks (§37) ----------------------------------------------------------- */
  for (const talk of TALKS) {
    const code = talk.company;
    await prisma.toolboxTalk.upsert({
      where: { id: talk.id },
      update: {},
      create: { id: talk.id, companyId: companyId(code), talkNumber: talk.number, title: talk.title, topic: talk.topic, projectId: projectId(talk.project), talkDate: day(talk.day), locationText: code === BCI ? "Tirana Lake — site office" : "The Courtyard — site office", conductedByMemberId: m(talk.by, code), status: talk.completed ? "COMPLETED" : "DRAFT", completedAt: talk.completed ? at(talk.day, 8) : null, createdByMemberId: m(talk.by, code), createdAt: at(talk.day - 2, 15) },
    });
    if ((await prisma.toolboxTalkParticipant.count({ where: { toolboxTalkId: talk.id } })) > 0) continue;
    await prisma.toolboxTalkParticipant.createMany({
      data: [
        ...talk.workers.map((worker, index) => ({ id: `${talk.id}_w_${index + 1}`, toolboxTalkId: talk.id, employeeProfileId: workerEmploymentId(worker), attendanceStatus: "ATTENDED" as const, signatureRecorded: true })),
        ...(talk.absent ?? []).map((worker, index) => ({ id: `${talk.id}_a_${index + 1}`, toolboxTalkId: talk.id, employeeProfileId: workerEmploymentId(worker), attendanceStatus: "ABSENT" as const, signatureRecorded: false })),
        ...talk.logins.map((login, index) => ({ id: `${talk.id}_m_${index + 1}`, toolboxTalkId: talk.id, companyMemberId: m(login, code), attendanceStatus: "ATTENDED" as const, signatureRecorded: true })),
      ],
    });
  }

  /* Incidents (§37) ------------------------------------------------------------------ */
  await prisma.hseIncident.upsert({
    where: { id: "armaar_hse_inc_tl_0008" },
    update: {},
    create: { id: "armaar_hse_inc_tl_0008", companyId: companyId(BCI), projectId: projectId("TIRANA_LAKE"), incidentNumber: "INC-2026-0008", incidentType: "FIRST_AID", title: "Cut hand — rebar tie wire, Tower A level 10", description: "A steel fixer cut the back of his hand on a tie-wire end while fixing the level 10 slab.", occurredAt: at(-18, 11), reportedAt: at(-18, 11), locationText: "Tower A — level 10", severity: "LOW", status: "CLOSED", reportedByMemberId: m("arlis.site-supervisor", BCI), investigatorMemberId: m("arlis.hse-officer", BCI), injuryOccurred: true, firstAidRequired: true, immediateAction: "Cleaned and dressed at the site first-aid point; back at work the same day.", investigationSummary: "Tie-wire ends left pointing up; gloves were worn but cut-resistant ones were not.", rootCause: "Standard gloves issued for fixing work.", lessonsLearned: "Cut-resistant gloves for every steel fixer; tie-wire ends turned down.", closedAt: at(-11, 16), closedByMemberId: m("arlis.hse", BCI), closureNote: "Cut-resistant gloves issued to the steel-fixing crew.", createdByMemberId: m("arlis.hse-officer", BCI), createdAt: at(-18, 12) },
  });

  /* Permits to work (§37) ------------------------------------------------------------ */
  const permits = [
    { id: "armaar_ptw_tl_0014", number: "PTW-2026-0014", type: "HOT_WORK" as const, title: "Torch-on membrane — podium roof, zone 3", status: "ACTIVE" as const, from: -1, until: 1, location: "Podium roof — zone 3", hazards: "Open flame on a bituminous roof next to the plant room.", controls: "Fire watch for sixty minutes after the last torch; two extinguishers at the work face.", ppe: "Flame-retardant overalls, gloves, eye protection." },
    { id: "armaar_ptw_tl_0015", number: "PTW-2026-0015", type: "LIFTING" as const, title: "Curtain-wall unit lifts — Tower B levels 4 to 6", status: "PENDING_APPROVAL" as const, from: 1, until: 5, location: "Tower B — east elevation", hazards: "Suspended loads above the promenade.", controls: "Exclusion zone below the lift path; banksman and radio.", ppe: "Standard site PPE." },
    { id: "armaar_ptw_tl_0012", number: "PTW-2026-0012", type: "WORK_AT_HEIGHT" as const, title: "Façade installation — Tower B levels 1 to 3", status: "CLOSED" as const, from: -20, until: -10, location: "Tower B — east elevation", hazards: "Work from the mast climber at up to twelve metres.", controls: "Anchor line; clip on at the gate; daily platform check.", ppe: "Full harness with twin lanyard." },
  ];
  for (const permit of permits) {
    const requested = m("arlis.site-supervisor", BCI);
    const approver = m("arlis.hse", BCI);
    const approved = permit.status !== "PENDING_APPROVAL";
    await prisma.hseWorkPermit.upsert({
      where: { id: permit.id },
      update: {},
      create: { id: permit.id, companyId: companyId(BCI), permitNumber: permit.number, permitType: permit.type, title: permit.title, projectId: projectId("TIRANA_LAKE"), locationText: permit.location, validFrom: at(permit.from, 7), validUntil: at(permit.until, 18), requestedByMemberId: requested, responsibleMemberId: requested, status: permit.status, hazardsSummary: permit.hazards, controlsSummary: permit.controls, ppeRequirements: permit.ppe, submittedAt: at(permit.from - 1, 15), approvedAt: approved ? at(permit.from - 1, 17) : null, approvedByMemberId: approved ? approver : null, activatedAt: approved ? at(permit.from, 7) : null, closedAt: permit.status === "CLOSED" ? at(permit.until, 18) : null, closedByMemberId: permit.status === "CLOSED" ? approver : null, createdByMemberId: requested, createdAt: at(permit.from - 2, 10) },
    });
    if (!approved) {
      await prisma.hseApproval.upsert({ where: { id: `${permit.id}_approval` }, update: {}, create: { id: `${permit.id}_approval`, companyId: companyId(BCI), recordType: "WORK_PERMIT", recordId: permit.id, status: "PENDING", submittedByMemberId: requested, submittedAt: at(permit.from - 1, 15) } });
    }
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    inspections: await prisma.hseInspection.count({ where: inGroup }),
    hazards: await prisma.hseHazard.count({ where: inGroup }),
    actions: await prisma.hseAction.count({ where: inGroup }),
    talks: await prisma.toolboxTalk.count({ where: inGroup }),
    incidents: await prisma.hseIncident.count({ where: inGroup }),
    permits: await prisma.hseWorkPermit.count({ where: inGroup }),
  };
}
