/**
 * Health and safety on every site that is building: weekly safety walks, the
 * hazards they turned up and what was done about them, a near miss, a first
 * aid case and a damaged hoarding, permits to work, Monday toolbox talks with
 * who attended, risk assessments, PPE spot checks, environmental observations
 * and one stop-work order, released.
 */
import type { EnvironmentalCategory, HseHazardCategory, HseIncidentType, HseInspectionType, HsePermitStatus, HsePermitType, HseSeverity, PrismaClient } from "@prisma/client";

import { at, businessDay, castOf, Numbers, random, type Clock } from "./kit";

const HSE_PROJECTS = ["project_b", "project_c", "project_d", "project_e", "project_showcase_promenada"];

const HAZARDS: Array<{ title: string; description: string; category: HseHazardCategory; likelihood: number; severity: number; control: string }> = [
  { title: "Open slab edge without a guardrail", description: "Edge protection removed on the west side for a delivery and not put back.", category: "WORK_AT_HEIGHT", likelihood: 3, severity: 5, control: "Guardrail reinstated; deliveries now through the loading platform only." },
  { title: "Extension lead through standing water", description: "A 230 V lead to the mixer runs through a puddle by the hoist.", category: "ELECTRICAL", likelihood: 3, severity: 4, control: "Lead raised on hooks; RCD tested." },
  { title: "Rebar starter bars without caps", description: "Starter bars at waist height along the stair core.", category: "HOUSEKEEPING", likelihood: 4, severity: 3, control: "Mushroom caps fitted on all starters." },
  { title: "Crane lifting over the public footpath", description: "Slew path crosses the footpath on the boulevard side.", category: "LIFTING", likelihood: 2, severity: 5, control: "Slew limiter set; banksman at the footpath during lifts." },
  { title: "Excavation edge with no barrier", description: "1.8 m deep trench next to the site road.", category: "EXCAVATION", likelihood: 3, severity: 4, control: "Barriers and signage along the trench; spoil kept 1 m back." },
  { title: "Diesel stored next to the welding bay", description: "Two jerrycans of diesel left beside hot work.", category: "FIRE", likelihood: 2, severity: 4, control: "Fuel moved to the bunded store; fire extinguisher at the bay." },
  { title: "Reversing trucks without a banksman", description: "Concrete trucks reverse into the gate without guidance.", category: "VEHICLE", likelihood: 3, severity: 4, control: "Banksman at the gate from 7:00 to 17:00." },
  { title: "Dust from cutting blocks", description: "Dry cutting of clay blocks on level 3.", category: "CHEMICAL", likelihood: 4, severity: 2, control: "Wet cutting only; FFP3 masks issued." },
];

const INCIDENTS: Array<{ type: HseIncidentType; title: string; description: string; severity: HseSeverity; root: string; firstAid?: boolean; damage?: boolean }> = [
  { type: "NEAR_MISS", title: "Plywood sheet blown off level 9", description: "A gust lifted an unsecured plywood sheet; it landed inside the exclusion zone. No one hurt.", severity: "MEDIUM", root: "Loose sheets left unsecured at the end of the shift." },
  { type: "FIRST_AID", title: "Cut hand while stripping formwork", description: "A carpenter cut his left hand on a nail while stripping formwork. Cleaned and dressed on site.", severity: "LOW", root: "Gloves removed for fine work.", firstAid: true },
  { type: "PROPERTY_DAMAGE", title: "Telehandler damaged the site hoarding", description: "Reversing telehandler struck the hoarding by the north gate; two panels bent.", severity: "LOW", root: "Blind spot on reversing; no banksman.", damage: true },
];

const PERMITS: Array<{ type: HsePermitType; title: string; location: string; hazards: string; controls: string; ppe: string; from: number; to: number; status: HsePermitStatus }> = [
  { type: "HOT_WORK", title: "Welding of balcony brackets", location: "West façade, levels 6–8", hazards: "Fire, burns, fumes", controls: "Fire watch for 60 minutes after work; extinguisher at each station.", ppe: "Welding mask, leather gloves, FR overalls", from: 0, to: 1, status: "ACTIVE" },
  { type: "WORK_AT_HEIGHT", title: "Installation of façade brackets from the MEWP", location: "North elevation", hazards: "Falls from height, falling objects", controls: "Harness clipped to the basket; exclusion zone below.", ppe: "Harness, helmet with chinstrap", from: -1, to: 6, status: "ACTIVE" },
  { type: "EXCAVATION", title: "Drainage trench along the boundary", location: "Site boundary", hazards: "Collapse, buried services", controls: "Services scanned; trench boxes fitted below 1.2 m.", ppe: "Helmet, boots, hi-vis", from: -30, to: -12, status: "CLOSED" },
  { type: "LIFTING", title: "Tandem lift of the plant-room skid", location: "Roof", hazards: "Load swing, overload", controls: "Lift plan approved; two banksmen; wind below 30 km/h.", ppe: "Helmet, gloves", from: 2, to: 2, status: "APPROVED" },
  { type: "CONFINED_SPACE", title: "Inspection of the water tank", location: "Basement 1", hazards: "Oxygen deficiency", controls: "Gas test before entry; standby person at the hatch.", ppe: "Gas detector, harness and tripod", from: -9, to: -8, status: "EXPIRED" },
];

const TALKS = ["Working at height: clip on, every time", "Manual handling of blocks", "Hot work and fire watch", "Excavation safety", "Housekeeping on the slab", "Wet weather: slips and electrics", "Crane signals and exclusion zones", "PPE: what to wear, where", "Reporting near misses", "Dust and silica"];

const ENVIRONMENT: Array<{ category: EnvironmentalCategory; title: string; description: string; severity: HseSeverity; action: string }> = [
  { category: "DUST", title: "Dust drifting over the neighbours' cars", description: "Dry, windy day; dust from the yard blowing over the street.", severity: "MEDIUM", action: "Yard dampened twice a day; wheel wash at the gate." },
  { category: "NOISE", title: "Breaker used before 8:00", description: "A neighbour complained about breaking from 7:15.", severity: "LOW", action: "Noisy work moved to 8:00–18:00." },
  { category: "WASTE", title: "Mixed waste in the timber skip", description: "Plasterboard and plastic in the timber skip.", severity: "LOW", action: "Skips relabelled; toolbox talk on waste separation." },
  { category: "SPILL", title: "Hydraulic oil leak under the excavator", description: "Small leak from a hose; about 2 litres on the ground.", severity: "MEDIUM", action: "Spill kit used; contaminated soil bagged; hose replaced." },
];

const riskOf = (likelihood: number, severity: number) => {
  const score = likelihood * severity;
  return { likelihood, severityScore: severity, riskScore: score, riskLevel: score <= 4 ? ("LOW" as const) : score <= 9 ? ("MEDIUM" as const) : score <= 16 ? ("HIGH" as const) : ("CRITICAL" as const) };
};

export async function seedShowcaseHse(prisma: PrismaClient, clock: Clock) {
  const numbers = new Numbers(prisma);
  const totals = { inspections: 0, hazards: 0, incidents: 0, actions: 0, permits: 0, talks: 0, assessments: 0, ppe: 0, environmental: 0, stopWork: 0 };
  for (const projectId of HSE_PROJECTS) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true, name: true } });
    const cast = await castOf(prisma, project.companyId!);
    const rand = random(`hse:${projectId}`);
    const n = (table: string, column: string, prefix: string, offset: number) => numbers.take({ companyId: cast.companyId, table, column, prefix, year: at(clock, offset).getUTCFullYear() });
    const hse = cast.member("hse");

    // Weekly safety walks: ten done, one waiting for approval, next week's scheduled.
    const inspections: string[] = [];
    for (let week = 10; week >= -1; week -= 1) {
      const day = -week * 7 + 1;
      const type: HseInspectionType = week % 3 === 0 ? "WORK_AT_HEIGHT" : week % 4 === 0 ? "LIFTING" : "SITE_SAFETY";
      const done = week >= 1;
      const pending = week === 0;
      const result = done ? (rand.chance(0.15) ? "FAIL" : rand.chance(0.25) ? "CONDITIONAL" : "PASS") : "NOT_SET";
      const inspection = await prisma.hseInspection.create({
        data: {
          companyId: cast.companyId, inspectionNumber: await n("hse_inspections", "inspectionNumber", "HSE-INS", day), inspectionType: type, projectId, assignedInspectorMemberId: hse, executedByMemberId: done || pending ? hse : null,
          status: done ? "CLOSED" : pending ? "PENDING_APPROVAL" : "SCHEDULED", result: pending ? "CONDITIONAL" : result, scheduledDate: at(clock, day, 8), inspectionDate: done || pending ? at(clock, day, 9) : null,
          locationText: "Whole site", summary: done ? (result === "PASS" ? "Site in good order; minor housekeeping items closed on the spot." : "Findings raised as hazards; see the action list.") : pending ? "Two edge-protection gaps on the upper slab; otherwise in order." : null,
          submittedAt: done || pending ? at(clock, day, 12) : null, approvedAt: done ? at(clock, day + 1, 9) : null, approvedByMemberId: done ? cast.member("pm") : null, closedAt: done ? at(clock, day + 2, 9) : null, closedByMemberId: done ? hse : null,
          createdByMemberId: hse, createdAt: at(clock, day - 3),
        },
        select: { id: true },
      });
      inspections.push(inspection.id);
      totals.inspections += 1;
    }

    // Hazards from those walks, at every stage of being dealt with.
    const hazards = rand.next() < 0.5 ? HAZARDS.slice(0, 6) : HAZARDS.slice(2, 8);
    for (const [index, hazard] of hazards.entries()) {
      const observed = -rand.int(2, 60);
      const status = observed < -30 ? "CLOSED" : index % 3 === 0 ? "OPEN" : index % 3 === 1 ? "IN_PROGRESS" : "CONTROLLED";
      const risk = riskOf(hazard.likelihood, hazard.severity);
      const record = await prisma.hseHazard.create({
        data: {
          companyId: cast.companyId, hazardNumber: await n("hse_hazards", "hazardNumber", "HZ", observed), title: hazard.title, description: hazard.description, projectId, inspectionId: inspections[index % 10], hazardCategory: hazard.category, ...risk,
          residualLikelihood: status === "CLOSED" || status === "CONTROLLED" ? 1 : null, residualSeverity: status === "CLOSED" || status === "CONTROLLED" ? hazard.severity : null,
          residualRiskScore: status === "CLOSED" || status === "CONTROLLED" ? hazard.severity : null, residualRiskLevel: status === "CLOSED" || status === "CONTROLLED" ? riskOf(1, hazard.severity).riskLevel : null,
          status, locationText: rand.pick(["Level 9 slab", "North gate", "Stair core", "Basement ramp", "West façade"]), observedAt: at(clock, observed), reportedByMemberId: hse, assignedToMemberId: cast.member("pm"),
          immediateControl: "Area barriered off until made safe.", controlMeasure: hazard.control, dueDate: businessDay(clock, observed + 7),
          closedAt: status === "CLOSED" ? at(clock, observed + 5) : null, closedByMemberId: status === "CLOSED" ? hse : null, closureNote: status === "CLOSED" ? "Checked on the next walk; control in place." : null,
          createdByMemberId: hse, createdAt: at(clock, observed),
        },
        select: { id: true },
      });
      totals.hazards += 1;
      await action(record.id, "hazardId", hazard.control, status === "CLOSED" ? "VERIFIED" : status === "OPEN" ? "OPEN" : "IN_PROGRESS", observed);
    }

    // Three incidents: a near miss, a first-aid case and some damage.
    for (const [index, incident] of INCIDENTS.entries()) {
      const occurred = -rand.int(5, 80);
      const status = occurred < -40 ? "CLOSED" : index === 0 ? "UNDER_INVESTIGATION" : "ACTIONS_OPEN";
      const record = await prisma.hseIncident.create({
        data: {
          companyId: cast.companyId, incidentNumber: await n("hse_incidents", "incidentNumber", "INC", occurred), incidentType: incident.type, title: incident.title, description: incident.description, projectId, occurredAt: at(clock, occurred, 11), reportedAt: at(clock, occurred, 12),
          locationText: rand.pick(["Level 9", "Ground floor", "North gate", "Formwork yard"]), severity: incident.severity, status, reportedByMemberId: cast.member("engineer"), investigatorMemberId: hse,
          injuryOccurred: incident.firstAid ?? false, firstAidRequired: incident.firstAid ?? false, propertyDamage: incident.damage ?? false, immediateAction: "Area made safe and the crew briefed.",
          investigationSummary: status === "UNDER_INVESTIGATION" ? null : "Statements taken from the crew and the supervisor.", rootCause: status === "UNDER_INVESTIGATION" ? null : incident.root,
          lessonsLearned: status === "CLOSED" ? "Shared at the next toolbox talk on every site of the group." : null, dueDate: businessDay(clock, occurred + 14),
          closedAt: status === "CLOSED" ? at(clock, occurred + 12) : null, closedByMemberId: status === "CLOSED" ? hse : null, closureNote: status === "CLOSED" ? "Actions verified." : null,
          createdByMemberId: cast.member("engineer"), createdAt: at(clock, occurred, 12),
        },
        select: { id: true },
      });
      totals.incidents += 1;
      await action(record.id, "incidentId", `Prevent a repeat: ${incident.root.toLowerCase()}`, status === "CLOSED" ? "VERIFIED" : "OPEN", occurred);
    }

    // Permits to work in every state.
    for (const permit of PERMITS) {
      await prisma.hseWorkPermit.create({
        data: {
          companyId: cast.companyId, permitNumber: await n("hse_work_permits", "permitNumber", "PTW", permit.from), permitType: permit.type, title: permit.title, projectId, locationText: permit.location,
          validFrom: at(clock, permit.from, 7), validUntil: at(clock, permit.to, 18), requestedByMemberId: cast.member("engineer"), responsibleMemberId: cast.member("pm"), status: permit.status,
          hazardsSummary: permit.hazards, controlsSummary: permit.controls, ppeRequirements: permit.ppe, submittedAt: at(clock, permit.from - 2), approvedAt: at(clock, permit.from - 1), approvedByMemberId: hse,
          activatedAt: permit.status === "ACTIVE" || permit.status === "CLOSED" || permit.status === "EXPIRED" ? at(clock, permit.from, 7) : null, closedAt: permit.status === "CLOSED" ? at(clock, permit.to, 18) : null, closedByMemberId: permit.status === "CLOSED" ? hse : null,
          createdByMemberId: cast.member("engineer"), createdAt: at(clock, permit.from - 2),
        },
      });
      totals.permits += 1;
    }

    // Monday toolbox talks with who attended.
    const people = [cast.member("pm"), cast.member("engineer"), hse];
    for (let week = 9; week >= 0; week -= 1) {
      const day = -week * 7 - ((clock.now.getUTCDay() + 6) % 7);
      const talk = await prisma.toolboxTalk.create({
        data: { companyId: cast.companyId, talkNumber: await n("toolbox_talks", "talkNumber", "TBT", day), title: TALKS[week % TALKS.length]!, topic: TALKS[week % TALKS.length]!, projectId, talkDate: at(clock, day, 7), locationText: "Site welfare unit", conductedByMemberId: hse, status: "COMPLETED", completedAt: at(clock, day, 8), createdByMemberId: hse, createdAt: at(clock, day - 1) },
        select: { id: true },
      });
      await prisma.toolboxTalkParticipant.createMany({
        data: [
          ...people.map((memberId) => ({ toolboxTalkId: talk.id, companyMemberId: memberId, attendanceStatus: "ATTENDED" as const, signatureRecorded: true })),
          ...["Formwork crew (12)", "Rebar crew (8)", "Subcontractor crew (9)"].map((externalName, index) => ({ toolboxTalkId: talk.id, externalName, attendanceStatus: index === 2 && week % 4 === 0 ? ("ABSENT" as const) : ("ATTENDED" as const), signatureRecorded: true })),
        ],
      });
      totals.talks += 1;
    }

    // Risk assessments for the main activities.
    for (const [index, title] of ["Slab pours with the concrete pump", "Façade installation from MEWPs", "Tower crane operations", "Work in excavations"].entries()) {
      const day = -200 + index * 40;
      await prisma.hseRiskAssessment.create({
        data: { companyId: cast.companyId, assessmentNumber: await n("hse_risk_assessments", "assessmentNumber", "RA", day), title, description: `Method, hazards and controls for ${title.toLowerCase()}.`, projectId, activityType: title.split(" ")[0], locationText: "Whole site", version: 1, status: index === 3 ? "PENDING_APPROVAL" : "APPROVED", ownerMemberId: hse, assessmentDate: businessDay(clock, day), reviewDate: businessDay(clock, day + 180), submittedAt: at(clock, day), approvedAt: index === 3 ? null : at(clock, day + 2), approvedByMemberId: index === 3 ? null : cast.member("pm"), createdByMemberId: hse, createdAt: at(clock, day) },
      });
      totals.assessments += 1;
    }

    // PPE spot checks.
    for (let check = 0; check < 6; check += 1) {
      const day = -check * 9 - 2;
      const fail = check === 2;
      await prisma.ppeCheck.create({
        data: { companyId: cast.companyId, checkNumber: await n("ppe_checks", "checkNumber", "PPE", day), projectId, checkDate: at(clock, day, 10), locationText: rand.pick(["Level 9", "Ground floor", "Basement", "Yard"]), checkedByMemberId: hse, externalSubjectName: rand.pick(["Formwork carpenter", "Steel fixer", "Electrician", "Labourer"]), helmetOk: true, eyeProtectionOk: !fail, glovesOk: true, footwearOk: true, harnessOk: fail ? false : null, hearingProtectionOk: true, result: fail ? "FAIL" : check === 4 ? "CONDITIONAL" : "PASS", notes: fail ? "No harness on the edge; stood down until fitted." : null, createdByMemberId: hse, createdAt: at(clock, day, 10) },
      });
      totals.ppe += 1;
    }

    // Environmental observations.
    for (const [index, observation] of ENVIRONMENT.slice(0, 3 + (projectId === "project_c" ? 1 : 0)).entries()) {
      const day = -rand.int(3, 50);
      const closed = index === 2 || day < -30;
      await prisma.environmentalObservation.create({
        data: { companyId: cast.companyId, observationNumber: await n("environmental_observations", "observationNumber", "ENV", day), projectId, category: observation.category, title: observation.title, description: observation.description, observedAt: at(clock, day), locationText: "Site boundary", severity: observation.severity, status: closed ? "CLOSED" : "IN_PROGRESS", reportedByMemberId: hse, assignedToMemberId: cast.member("pm"), immediateAction: observation.action, dueDate: businessDay(clock, day + 10), closedAt: closed ? at(clock, day + 6) : null, closedByMemberId: closed ? hse : null, closureNote: closed ? "Measures in place." : null, createdByMemberId: hse, createdAt: at(clock, day) },
      });
      totals.environmental += 1;
    }

    // One stop-work on the tower crane in high wind, released next morning.
    if (projectId === "project_b" || projectId === "project_e") {
      await prisma.stopWorkRecord.create({
        data: { companyId: cast.companyId, stopWorkNumber: await n("stop_work_records", "stopWorkNumber", "SW", -16), projectId, title: "Crane stopped in high wind", reason: "Gusts above 60 km/h at the jib; all lifting stopped.", locationText: "Tower crane TC-1", issuedAt: at(clock, -16, 13), issuedByMemberId: hse, status: "RELEASED", releasedAt: at(clock, -15, 8), releasedByMemberId: hse, releaseReason: "Wind dropped below 30 km/h; crane checked.", createdByMemberId: hse, createdAt: at(clock, -16, 13) },
      });
      totals.stopWork += 1;
    }

    async function action(sourceId: string, link: "hazardId" | "incidentId", title: string, status: "OPEN" | "IN_PROGRESS" | "VERIFIED", raised: number) {
      await prisma.hseAction.create({
        data: {
          companyId: cast.companyId, actionNumber: await n("hse_actions", "actionNumber", "HSA", raised), actionType: link === "hazardId" ? "CORRECTIVE" : "PREVENTIVE", title: title.length > 120 ? `${title.slice(0, 117)}…` : title, description: title, projectId, [link]: sourceId,
          assignedToMemberId: cast.member("pm"), dueDate: businessDay(clock, raised + 10), priority: link === "incidentId" ? "HIGH" : "MEDIUM", status,
          completedAt: status === "VERIFIED" ? at(clock, raised + 5) : null, completedByMemberId: status === "VERIFIED" ? cast.member("pm") : null, verifiedAt: status === "VERIFIED" ? at(clock, raised + 6) : null, verifiedByMemberId: status === "VERIFIED" ? hse : null, verificationNote: status === "VERIFIED" ? "Seen in place on the next walk." : null,
          createdByMemberId: hse, createdAt: at(clock, raised),
        },
      });
      totals.actions += 1;
    }
  }
  return totals;
}

