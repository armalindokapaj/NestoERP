/**
 * ARMAAR's people, sites and paperwork, lived in (D-04 enrichment: HR, HSE,
 * quality, legal and collaboration).
 *
 * Only what already exists is used: the seeded logins and their employments,
 * the site workers without a login, the projects and their companies. On them:
 *
 *   leave          two requests for most employees with a login — taken, on
 *                  leave today, booked, waiting, drafts, turned down and
 *                  withdrawn — with this year's balances agreeing with the
 *                  approved annual leave, and the ON_LEAVE days approval writes
 *   HSE            fortnightly inspections on every working site, hazards with
 *                  their actions, toolbox talks signed by the crews, incidents
 *                  and permits to work in every state
 *   quality        inspections, NCRs and their corrective actions, snags
 *   legal          more contracts across the companies in every state, their
 *                  parties, obligations falling due, and amendments
 *   documents      site reports, HSE and QA reports, drawings and minutes
 *   announcements  published, scheduled, drafts, expired and archived; some
 *                  asking to be acknowledged, some read
 *
 * Pending records are what the Approvals Center reads, so each state that waits
 * for somebody carries the approval row its module writes. Numbers continue each
 * company's series. Every value is synthetic. Stable ids (`armaar_d04_…`); a
 * rerun adds nothing.
 */
import { Prisma, type AnnouncementPriority, type AnnouncementStatus, type ContractStatus, type ContractType, type CorrectiveActionStatus, type HseActionStatus, type HseHazardCategory, type HseHazardStatus, type HseIncidentStatus, type HseIncidentType, type HseInspectionType, type HsePermitStatus, type HsePermitType, type LeaveRequestStatus, type LeaveType, type NCRCategory, type NCRStatus, type PrismaClient, type QualityDefectStatus, type QualityInspectionStatus, type QualitySeverity } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { assessRisk } from "../../../lib/modules/hse/hse.risk";
import { countWorkingDays, workingDaysBetween } from "../../../lib/modules/hr/hr.calendar";
import { addDays, businessTimestamp, todayDay } from "../../../lib/modules/hr/employment/employment.dates";
import { seedStoredDocument } from "../document-objects";
import { memberId } from "./access";
import { random, series } from "./enrich-finance";
import { companyId } from "./organization";
import { userId } from "./people";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";
import { workerEmploymentId } from "./workforce";

const ZONE = "Europe/Tirane";
const EUR = "EUR";
const P = "armaar_d04_";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const ALN = "ARLIS_NDERTIM" as const;
const IDEAL = "IDEAL_CONSTRUCTION" as const;
const UNICO = "UNICO_CONSTRUCTION" as const;
const SMI = "SARANDA_MARINA_INVEST" as const;
const ARSOL = "ARSOL_ENERGY" as const;
const ALA = "ARLIS_ADMINISTRIM" as const;
const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

/** Who approves leave in each company: its HR, or the group's. */
const HR: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.hr", [ALN]: "arlis.hr", [IDEAL]: "armaar.hr", [UNICO]: "armaar.hr", [SMI]: "armaar.hr", [ARSOL]: "armaar.hr", [ALA]: "armaar.hr" };
const DIRECTOR: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.director", [ALN]: "arlis.director", [IDEAL]: "ideal.director", [UNICO]: "unico.director", [SMI]: "smi.director", [ARSOL]: "arsol.director", [ALA]: "arlisadm.director" };

/** The working sites, and who does safety and quality on each. */
type Site = { key: string; company: CompanyCode; project: ProjectCode; name: string; hse: string; hseLead: string; hseApprover: string; supervisor: string; engineer: string; qa: string; qaApprover: string; workers: string[]; logins: string[] };
const SITES: Site[] = [
  { key: "tl", company: BCI, project: "TIRANA_LAKE", name: "Tirana Lake", hse: "arlis.hse-officer", hseLead: "arlis.hse", hseApprover: "arlis.hse", supervisor: "arlis.site-supervisor", engineer: "arlis.site-engineer", qa: "arlis.qaqc-engineer", qaApprover: "bci.engineering", workers: ["bci_01", "bci_02", "bci_03", "bci_04", "bci_05", "bci_06", "bci_07", "bci_13", "bci_17", "bci_18", "bci_19"], logins: ["arlis.site-supervisor", "arlis.mep"] },
  { key: "et", company: IDEAL, project: "EYES_OF_TIRANA", name: "Eyes of Tirana", hse: "ideal.hse", hseLead: "ideal.hse", hseApprover: "ideal.director", supervisor: "ideal.site-engineer", engineer: "ideal.engineering", qa: "ideal.qaqc", qaApprover: "ideal.engineering", workers: [], logins: ["ideal.site-engineer", "ideal.pm"] },
  { key: "ut", company: UNICO, project: "UNITED_TOWERS", name: "United Towers", hse: "armaar.hse", hseLead: "armaar.hse", hseApprover: "unico.director", supervisor: "unico.coordinator", engineer: "unico.engineering", qa: "armaar.qaqc", qaApprover: "unico.engineering", workers: ["unc_01", "unc_02"], logins: ["unico.coordinator", "unico.structural"] },
];

const HSE_CHECKLIST = ["Edge protection in place at every open edge", "Scaffolds tagged and inspected within seven days", "PPE worn in every work area", "Access routes and stairs clear", "Lifting exclusion zones barriered", "Fire extinguishers in date and at hand"];
const HAZARDS: Array<{ title: string; description: string; category: HseHazardCategory; likelihood: number; severity: number; control: string; action: string; location: string }> = [
  { title: "Missing toe boards on the level {n} scaffold lift", description: "Toe boards removed to pass materials and not replaced.", category: "WORK_AT_HEIGHT", likelihood: 3, severity: 4, control: "Lift closed until the boards were refitted.", action: "Refit toe boards and brief the scaffold crew", location: "Level {n} scaffold" },
  { title: "Damaged extension lead in the {z}", description: "Outer sheath split near the plug; conductors visible.", category: "ELECTRICAL", likelihood: 3, severity: 3, control: "Lead removed from use and tagged out.", action: "PAT-test every lead on site and replace the damaged ones", location: "{z}" },
  { title: "Rebar starters without caps — {z}", description: "Vertical starter bars left uncapped along the walkway.", category: "OTHER", likelihood: 3, severity: 3, control: "Area barriered.", action: "Cap every exposed starter bar", location: "{z}" },
  { title: "Diesel spill at the refuelling point", description: "About 20 litres spilled while refuelling the excavator; no drip tray used.", category: "ENVIRONMENTAL", likelihood: 2, severity: 3, control: "Spill kit used; contaminated soil bagged.", action: "Bunded refuelling point with a drip tray and a spill kit", location: "Plant yard" },
  { title: "Excavator working without a banksman — {z}", description: "The excavator was slewing next to the footpath with nobody guiding it.", category: "VEHICLE", likelihood: 3, severity: 4, control: "Work stopped until a banksman was posted.", action: "Banksman for every plant movement near people", location: "{z}" },
  { title: "Stacked materials blocking the fire exit", description: "Plasterboard stacked across the escape route from the level {n} stair.", category: "FIRE", likelihood: 2, severity: 4, control: "Materials moved the same hour.", action: "Mark fire exits as no-storage zones", location: "Level {n} stair" },
  { title: "Workers without hearing protection at the concrete saw", description: "Two operatives cutting without ear defenders.", category: "PPE", likelihood: 4, severity: 2, control: "Ear defenders issued on the spot.", action: "Hearing-protection zone signs at every saw", location: "{z}" },
  { title: "Loose cables across the access route", description: "Temporary power cables laid across the main access without covers.", category: "HOUSEKEEPING", likelihood: 3, severity: 2, control: "Cables lifted onto hooks.", action: "Cable hooks and ramps along every route", location: "Main access" },
];
const HAZARD_STATES: HseHazardStatus[] = ["CLOSED", "CLOSED", "CONTROLLED", "OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "CLOSED", "CANCELLED"];
const ACTION_FOR: Record<HseHazardStatus, HseActionStatus | null> = { CLOSED: "VERIFIED", CONTROLLED: "IN_PROGRESS", OPEN: "OPEN", IN_PROGRESS: "IN_PROGRESS", PENDING_VERIFICATION: "PENDING_VERIFICATION", CANCELLED: null, REOPENED: "REOPENED" };
const TALKS = [
  ["Manual handling", "Lifting blocks and bags: bend the knees, two people above 25 kg."],
  ["Working near excavations", "Barriers, ladders, and never under a raised bucket."],
  ["Heat stress", "Water, shade and the midday break in the hot months."],
  ["Electrical safety on site", "Only tested leads; report damage, never tape it."],
  ["Hand-arm vibration", "Rotate the breaker every thirty minutes and log the time."],
  ["Housekeeping and access routes", "Clear stairs and landings; where offcuts go."],
  ["Fire on site", "Where the extinguishers are, the assembly point, and hot-work permits."],
  ["Mobile plant and pedestrians", "Walkways, banksmen and eye contact with the operator."],
  ["Working at height", "Harness checks, anchor points and the rescue plan."],
] as const;
const ZONES: Record<string, string[]> = { tl: ["Tower A core", "Tower B podium", "the loading bay"], tc: ["Block 2", "Block 3 courtyard", "the basement ramp"], fr: ["Block C", "Block B basement", "the drainage run"], et: ["the piling platform", "the north boundary", "the demolition area"], ut: ["the piling mat", "tower 2 footprint", "the site entrance"], gm: ["the hotel block", "villas cluster A", "the beach terrace"] };

const QA_TEMPLATES: Array<{ type: "WORK" | "MATERIAL" | "GENERAL"; title: string; checks: string[]; spec?: string }> = [
  { type: "WORK", title: "Pre-pour inspection — {z}, level {n}", checks: ["Reinforcement as drawn, with cover", "Formwork clean and propped", "Embedded services in place"], spec: "03 30 00 — Cast-in-place concrete" },
  { type: "MATERIAL", title: "Material inspection — rebar delivery", checks: ["Mill certificates match the delivery", "Bar marks and diameters as ordered", "No excessive rust or damage"] },
  { type: "WORK", title: "Blockwork inspection — {z}, level {n}", checks: ["Walls plumb within 5 mm", "Joints filled and even", "Lintels bearing 150 mm"] },
  { type: "WORK", title: "Waterproofing inspection — {z}", checks: ["Primer applied to the full area", "Laps at 100 mm and sealed", "Upstands at 150 mm"] },
  { type: "GENERAL", title: "Setting-out check — {z}", checks: ["Gridlines within ±3 mm", "Levels against the benchmark", "Survey record signed"] },
  { type: "WORK", title: "Screed inspection — {z}, level {n}", checks: ["Thickness within tolerance", "Falls to drains", "No cracking or hollowness"] },
];
const QA_STATES = ["CLOSED_PASS", "CLOSED_PASS", "CLOSED_FAIL", "CLOSED_PASS", "PENDING_APPROVAL", "IN_PROGRESS", "DRAFT"] as const;
const NCR_STATES: NCRStatus[] = ["CLOSED", "IN_PROGRESS", "OPEN", "PENDING_APPROVAL", "PENDING_VERIFICATION"];
const NCR_TEMPLATES: Array<{ title: string; description: string; category: NCRCategory; severity: QualitySeverity; action: string }> = [
  { title: "Concrete cover below specification — {z}", description: "Cover measured 20–25 mm against 35 mm specified.", category: "WORKMANSHIP", severity: "MEDIUM", action: "Apply the approved protective coating and re-check cover on the next pours" },
  { title: "Rebar delivered without mill certificates", description: "Delivery accepted on site without certificates for two bar sizes.", category: "SUPPLIER", severity: "LOW", action: "Obtain the certificates or quarantine the bars" },
  { title: "Blockwork out of plumb — {z}", description: "Wall out of plumb by 12 mm over the storey height.", category: "WORKMANSHIP", severity: "MEDIUM", action: "Take down and rebuild the affected panel" },
  { title: "Drawing revision not on site — {z}", description: "The crew worked from revision B; revision C was issued last week.", category: "DOCUMENTATION", severity: "LOW", action: "Withdraw superseded drawings and brief the foremen" },
  { title: "Cold joint in the retaining wall — {z}", description: "Pour interrupted for three hours; visible cold joint.", category: "PROCESS", severity: "HIGH", action: "Inject the joint with the approved resin and test" },
];
const DEFECTS = ["Cracked tile in the bathroom", "Door not closing flush", "Paint runs on the living room wall", "Missing silicone at the shower tray", "Scratched window frame", "Loose balustrade fixing", "Socket outlet not level", "Stain on the ceiling"];
const DEFECT_STATES: QualityDefectStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "CLOSED", "REOPENED"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function seedArmaarEnrichPeople(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const monthOf = (offset: number) => MONTHS[Number(addLocalDays(today, offset).slice(5, 7)) - 1]!;
  const m = (username: string, code: CompanyCode) => memberId(username, code);
  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  const fill = (text: string, values: { z?: string; n?: number }) => text.replace("{z}", values.z ?? "").replace("{n}", String(values.n ?? 1));
  const known = async (find: (args: { where: { id: { startsWith: string } }; select: { id: true } }) => Promise<Array<{ id: string }>>) => new Set((await find({ where: { id: { startsWith: P } }, select: { id: true } })).map((row) => row.id));

  /* Leave ---------------------------------------------------------------------- */
  const LEAVE: Array<{ start: number; length: number; type: LeaveType; status: LeaveRequestStatus; reason?: string; note?: string }> = [
    { start: -120, length: 5, type: "ANNUAL", status: "APPROVED" },
    { start: -60, length: 2, type: "SICK", status: "APPROVED", reason: "Flu; certificate provided." },
    { start: 20, length: 5, type: "ANNUAL", status: "PENDING" },
    { start: 40, length: 7, type: "ANNUAL", status: "APPROVED" },
    { start: 15, length: 8, type: "ANNUAL", status: "REJECTED", note: "Clashes with the handover of the show apartment; please move it by two weeks." },
    { start: 70, length: 3, type: "ANNUAL", status: "DRAFT" },
    { start: -30, length: 3, type: "ANNUAL", status: "CANCELLED" },
    { start: -10, length: 1, type: "OTHER", status: "APPROVED", reason: "Professional exam." },
    { start: 55, length: 4, type: "UNPAID", status: "PENDING", reason: "Family matter abroad." },
    { start: -90, length: 10, type: "ANNUAL", status: "APPROVED" },
    { start: -1, length: 1, type: "SICK", status: "PENDING", reason: "Doctor's appointment." },
    { start: -2, length: 5, type: "ANNUAL", status: "APPROVED" },
  ];
  const employees = await prisma.employeeProfile.findMany({
    where: { companyMemberId: { not: null }, employmentStatus: "ACTIVE", companyId: { in: Object.keys(HR).map((code) => companyId(code as CompanyCode)) } },
    orderBy: { id: "asc" },
    select: { id: true, companyId: true, companyMemberId: true },
  });
  const codeOf = new Map(Object.keys(HR).map((code) => [companyId(code as CompanyCode), code as CompanyCode]));
  const knownLeave = await known((args) => prisma.leaveRequest.findMany(args));
  const used = new Map<string, number>();
  const year = Number(todayDay().slice(0, 4));
  let leaveCount = 0;
  for (const [index, employee] of employees.entries()) {
    const code = codeOf.get(employee.companyId)!;
    const hr = m(HR[code]!, code);
    const approver = hr === employee.companyMemberId ? m(DIRECTOR[code]!, code) : hr;
    for (const plan of [LEAVE[index % LEAVE.length]!, LEAVE[(index + 5) % LEAVE.length]!]) {
      const startDate = businessTimestamp(addDays(todayDay(), plan.start));
      const endDate = businessTimestamp(addDays(todayDay(), plan.start + plan.length - 1));
      const days = countWorkingDays(startDate, endDate);
      if (days === 0) continue;
      const id = `${P}leave_${employee.id.replace(/^employee_armaar_/, "")}_${LEAVE.indexOf(plan) + 1}`;
      const approved = plan.status === "APPROVED";
      if (!knownLeave.has(id)) {
        await prisma.leaveRequest.create({
          data: { id, companyId: employee.companyId, employeeProfileId: employee.id, companyMemberId: employee.companyMemberId, leaveType: plan.type, startDate, endDate, days: new Prisma.Decimal(days), reason: plan.reason ?? null, status: plan.status, submittedAt: plan.status === "DRAFT" ? null : at(Math.min(plan.start - 14, -1), 9), approvedByMemberId: approved ? approver : null, approvedAt: approved ? at(Math.min(plan.start - 10, 0), 11) : null, rejectedByMemberId: plan.status === "REJECTED" ? approver : null, rejectedAt: plan.status === "REJECTED" ? at(-2, 11) : null, cancelledByMemberId: plan.status === "CANCELLED" ? employee.companyMemberId : null, cancelledAt: plan.status === "CANCELLED" ? at(plan.start - 8, 16) : null, decisionNote: plan.note ?? null, createdByMemberId: employee.companyMemberId!, createdAt: at(Math.min(plan.start - 15, -1), 9) },
        });
        // Approval writes the leave's working days as ON_LEAVE, where nothing is recorded yet.
        if (approved) {
          const dates = workingDaysBetween(startDate, endDate);
          const taken = new Set((await prisma.attendanceRecord.findMany({ where: { employeeProfileId: employee.id, date: { in: dates } }, select: { date: true } })).map((row) => row.date.getTime()));
          const free = dates.filter((date) => !taken.has(date.getTime()));
          if (free.length) await prisma.attendanceRecord.createMany({ data: free.map((date) => ({ companyId: employee.companyId, employeeProfileId: employee.id, companyMemberId: employee.companyMemberId, date, status: "ON_LEAVE" as const, source: "SYSTEM" as const, sourceEntityType: "leave_request", sourceEntityId: id, createdByMemberId: approver })) });
        }
      }
      if (approved && plan.type === "ANNUAL" && startDate.getUTCFullYear() === year) used.set(employee.id, (used.get(employee.id) ?? 0) + days);
      leaveCount += 1;
    }
  }
  for (const employee of employees) {
    for (const [leaveType, entitled] of [["ANNUAL", 20], ["SICK", 10]] as const) {
      const usedDays = new Prisma.Decimal(leaveType === "ANNUAL" ? (used.get(employee.id) ?? 0) : 0);
      await prisma.leaveBalance.upsert({
        where: { employeeProfileId_leaveType_year: { employeeProfileId: employee.id, leaveType, year } },
        update: {},
        create: { id: `${P}lb_${employee.id.replace(/^employee_armaar_/, "")}_${leaveType.toLowerCase()}_${year}`, companyId: employee.companyId, employeeProfileId: employee.id, companyMemberId: employee.companyMemberId, leaveType, year, entitledDays: new Prisma.Decimal(entitled), usedDays, adjustmentDays: new Prisma.Decimal(0) },
      });
    }
  }

  /* HSE --------------------------------------------------------------------------- */
  const nextHseInspection = series((await prisma.hseInspection.findMany({ where: inGroup, select: { companyId: true, inspectionNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.inspectionNumber })), "HSE-INS");
  const nextHazard = series((await prisma.hseHazard.findMany({ where: inGroup, select: { companyId: true, hazardNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.hazardNumber })), "HZ");
  const nextHseAction = series((await prisma.hseAction.findMany({ where: inGroup, select: { companyId: true, actionNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.actionNumber })), "HSE-ACT");
  const nextTalk = series((await prisma.toolboxTalk.findMany({ where: inGroup, select: { companyId: true, talkNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.talkNumber })), "TBT");
  const nextIncident = series((await prisma.hseIncident.findMany({ where: inGroup, select: { companyId: true, incidentNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.incidentNumber })), "INC");
  const nextPermit = series((await prisma.hseWorkPermit.findMany({ where: inGroup, select: { companyId: true, permitNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.permitNumber })), "PTW");
  const knownHse = new Set([
    ...(await known((args) => prisma.hseInspection.findMany(args))),
    ...(await known((args) => prisma.hseHazard.findMany(args))),
    ...(await known((args) => prisma.hseAction.findMany(args))),
    ...(await known((args) => prisma.toolboxTalk.findMany(args))),
    ...(await known((args) => prisma.hseIncident.findMany(args))),
    ...(await known((args) => prisma.hseWorkPermit.findMany(args))),
  ]);

  for (const [si, site] of SITES.entries()) {
    const r = random(5_000 + si);
    const code = site.company;
    const company = companyId(code);
    const project = projectId(site.project);
    const inspector = m(site.hse, code);
    const approver = m(site.hseApprover, code);
    const lead = m(site.hseLead, code);
    const zones = ZONES[site.key]!;

    // Fortnightly inspections, from six months ago to a fortnight ahead.
    const offsets: number[] = [];
    for (let offset = -168 + si; offset <= 14; offset += 14) offsets.push(offset);
    const lastPast = Math.max(...offsets.filter((offset) => offset <= 0));
    for (const [index, offset] of offsets.entries()) {
      const id = `${P}hseins_${site.key}_${String(index + 1).padStart(2, "0")}`;
      const status = offset > 0 ? "SCHEDULED" : offset === lastPast ? "PENDING_APPROVAL" : "CLOSED";
      const executed = status !== "SCHEDULED";
      const closed = status === "CLOSED";
      const failed = executed && index % 3 === 1 ? [r.int(0, HSE_CHECKLIST.length - 1)] : [];
      const type: HseInspectionType = index % 4 === 3 ? r.pick(["WORK_AT_HEIGHT", "ELECTRICAL", "FIRE_SAFETY", "HOUSEKEEPING", "LIFTING"] as const) : "SITE_SAFETY";
      const title = type === "SITE_SAFETY" ? `Fortnightly site safety inspection — ${site.name}` : `${type.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())} inspection — ${site.name}`;
      if (!knownHse.has(id)) {
        await prisma.hseInspection.create({
          data: { id, companyId: company, inspectionNumber: nextHseInspection(company), inspectionType: type, projectId: project, assignedInspectorMemberId: inspector, executedByMemberId: executed ? inspector : null, status, result: executed ? (failed.length ? "CONDITIONAL" : "PASS") : "NOT_SET", scheduledDate: day(offset), inspectionDate: executed ? at(offset, 9) : null, locationText: `${site.name} — ${r.pick(zones)}`, summary: executed ? (failed.length ? `${title}: 1 item needs action.` : `${title}: all items satisfactory.`) : null, submittedAt: executed ? at(offset, 12) : null, approvedAt: closed ? at(offset + 1, 9) : null, approvedByMemberId: closed ? approver : null, closedAt: closed ? at(offset + 1, 10) : null, closedByMemberId: closed ? approver : null, createdByMemberId: inspector, createdAt: at(offset - 3, 9) },
        });
        await prisma.hseInspectionChecklistItem.createMany({
          data: HSE_CHECKLIST.map((label, item) => {
            const result = executed ? (failed.includes(item) ? ("FAIL" as const) : ("PASS" as const)) : null;
            return { id: `${id}_item_${item + 1}`, inspectionId: id, code: `C${item + 1}`, label, responseType: "PASS_FAIL" as const, required: true, sortOrder: item, responseValue: result, result, note: result === "FAIL" ? "Raised as an observation and an action." : null, riskIfFailed: "HIGH" as const, requiresNoteOnFail: true };
          }),
          skipDuplicates: true,
        });
      }
      if (status === "PENDING_APPROVAL") await prisma.hseApproval.upsert({ where: { id: `${id}_approval` }, update: {}, create: { id: `${id}_approval`, companyId: company, recordType: "INSPECTION", recordId: id, status: "PENDING", submittedByMemberId: inspector, submittedAt: at(offset, 12) } });
    }

    // Hazards and the action each asks for.
    for (let index = 0; index < 6; index += 1) {
      const template = HAZARDS[(index + si * 2) % HAZARDS.length]!;
      const status = HAZARD_STATES[(index + si) % HAZARD_STATES.length]!;
      const observed = status === "CLOSED" || status === "CANCELLED" ? -r.int(20, 170) : -r.int(1, 15);
      const due = observed + r.int(2, 7);
      const values = { z: r.pick(zones), n: r.int(2, 12) };
      const id = `${P}hz_${site.key}_${index + 1}`;
      const risk = assessRisk(template.likelihood, template.severity);
      const closed = status === "CLOSED";
      const residual = closed ? assessRisk(1, template.severity) : null;
      const reporter = m(index % 2 ? site.supervisor : site.hse, code);
      const assignee = m(site.supervisor, code);
      if (!knownHse.has(id)) {
        await prisma.hseHazard.create({
          data: { id, companyId: company, hazardNumber: nextHazard(company), title: fill(template.title, values), description: fill(template.description, values), projectId: project, hazardCategory: template.category, likelihood: template.likelihood, severityScore: template.severity, riskScore: risk.riskScore, riskLevel: risk.riskLevel, residualLikelihood: residual ? 1 : null, residualSeverity: residual ? template.severity : null, residualRiskScore: residual?.riskScore ?? null, residualRiskLevel: residual?.riskLevel ?? null, status, locationText: `${site.name} — ${fill(template.location, values)}`, observedAt: at(observed, 9), reportedByMemberId: reporter, assignedToMemberId: assignee, immediateControl: status === "OPEN" ? null : template.control, dueDate: day(due), closedAt: closed ? at(due, 15) : null, closedByMemberId: closed ? lead : null, closureNote: closed ? "Checked on the next walk; control in place." : status === "CANCELLED" ? "Duplicate of an observation already raised." : null, createdByMemberId: reporter, createdAt: at(observed, 9) },
        });
      }
      const actionStatus = ACTION_FOR[status];
      if (!actionStatus) continue;
      const actionId = `${P}hseact_${site.key}_${index + 1}`;
      const completed = actionStatus === "PENDING_VERIFICATION" || actionStatus === "VERIFIED";
      if (!knownHse.has(actionId)) {
        await prisma.hseAction.create({
          data: { id: actionId, companyId: company, actionNumber: nextHseAction(company), actionType: index % 3 === 0 ? "PREVENTIVE" : "CORRECTIVE", title: template.action, description: `${template.action}; photograph the result for the site diary.`, projectId: project, hazardId: id, assignedToMemberId: assignee, dueDate: day(due), priority: template.severity >= 4 ? "HIGH" : "MEDIUM", status: actionStatus, completionNote: completed ? "Done and photographed; see the site diary." : null, completedAt: completed ? at(due - 1, 15) : null, completedByMemberId: completed ? assignee : null, verificationNote: actionStatus === "VERIFIED" ? "Verified on the next inspection." : null, verifiedAt: actionStatus === "VERIFIED" ? at(due, 10) : null, verifiedByMemberId: actionStatus === "VERIFIED" ? lead : null, createdByMemberId: lead, createdAt: at(observed, 11) },
        });
      }
    }

    // Toolbox talks, every three weeks; the next one still a draft, one called off.
    for (let index = 0; index < 9; index += 1) {
      const offset = -170 + index * 21 + si;
      const [title, topic] = TALKS[(index + si) % TALKS.length]!;
      const id = `${P}tbt_${site.key}_${index + 1}`;
      const status = offset > 0 ? "DRAFT" : index === 3 ? "CANCELLED" : "COMPLETED";
      if (!knownHse.has(id)) {
        await prisma.toolboxTalk.create({ data: { id, companyId: company, talkNumber: nextTalk(company), title, topic, projectId: project, talkDate: day(offset), locationText: `${site.name} — site office`, conductedByMemberId: inspector, status, completedAt: status === "COMPLETED" ? at(offset, 8) : null, createdByMemberId: inspector, createdAt: at(offset - 2, 15) } });
        if (status === "COMPLETED") {
          const workers = site.workers.filter((_, w) => (w + index) % 3 !== 0);
          const absent = site.workers.filter((_, w) => (w + index) % 3 === 0).slice(0, 1);
          await prisma.toolboxTalkParticipant.createMany({
            data: [
              ...workers.map((worker, w) => ({ id: `${id}_w_${w + 1}`, toolboxTalkId: id, employeeProfileId: workerEmploymentId(worker), attendanceStatus: "ATTENDED" as const, signatureRecorded: true })),
              ...absent.map((worker, w) => ({ id: `${id}_a_${w + 1}`, toolboxTalkId: id, employeeProfileId: workerEmploymentId(worker), attendanceStatus: "ABSENT" as const, signatureRecorded: false })),
              ...site.logins.map((login, w) => ({ id: `${id}_m_${w + 1}`, toolboxTalkId: id, companyMemberId: m(login, code), attendanceStatus: "ATTENDED" as const, signatureRecorded: true })),
            ],
            skipDuplicates: true,
          });
        }
      }
    }

    // Incidents.
    const INCIDENTS: Array<{ type: HseIncidentType; title: string; description: string; severity: "LOW" | "MEDIUM" | "HIGH"; status: HseIncidentStatus; day: number; injury?: true; damage?: true; environment?: true }> = [
      { type: "NEAR_MISS", title: `Unsecured load swung near the crane operator's path — ${site.name}`, description: "A bundle of formwork panels swung during the lift; nobody was in its path.", severity: "MEDIUM", status: "CLOSED", day: -140 + si * 3 },
      { type: "FIRST_AID", title: `Eye irritation from cement dust — ${r.pick(zones)}`, description: "An operative mixing mortar got cement dust in his eye; goggles were not worn.", severity: "LOW", status: "CLOSED", day: -75 + si, injury: true },
      { type: si % 2 ? "VEHICLE_EVENT" : "PROPERTY_DAMAGE", title: si % 2 ? `Delivery truck reversed into a bollard — ${site.name}` : `Scaffold board fell onto a parked car — ${site.name}`, description: "No one hurt; damage recorded and photographed.", severity: "MEDIUM", status: si % 3 === 0 ? "PENDING_CLOSE" : si % 3 === 1 ? "ACTIONS_OPEN" : "UNDER_INVESTIGATION", day: -6 - si, damage: true },
    ];
    if (si === 5) INCIDENTS.push({ type: "ENVIRONMENTAL_EVENT", title: "Silty run-off reached the beach drain — Clearwater Beach", description: "Heavy rain washed silt from the excavation into the storm drain.", severity: "HIGH", status: "OPEN", day: -1, environment: true });
    for (const [index, incident] of INCIDENTS.entries()) {
      const id = `${P}inc_${site.key}_${index + 1}`;
      const closed = incident.status === "CLOSED";
      const investigated = incident.status !== "OPEN";
      if (!knownHse.has(id)) {
        await prisma.hseIncident.create({
          data: { id, companyId: company, projectId: project, incidentNumber: nextIncident(company), incidentType: incident.type, title: incident.title, description: incident.description, occurredAt: at(incident.day, 11), reportedAt: at(incident.day, 12), locationText: `${site.name} — ${r.pick(zones)}`, severity: incident.severity, status: incident.status, reportedByMemberId: m(site.supervisor, code), investigatorMemberId: investigated ? lead : null, injuryOccurred: incident.injury ?? false, firstAidRequired: incident.injury ?? false, propertyDamage: incident.damage ?? false, environmentalImpact: incident.environment ?? false, immediateAction: "Area made safe and the work stopped until checked.", investigationSummary: investigated && incident.status !== "UNDER_INVESTIGATION" ? "Statements taken; the lift plan and the site rules were reviewed." : null, rootCause: closed || incident.status === "PENDING_CLOSE" ? "The method statement was not briefed to the crew that day." : null, lessonsLearned: closed ? "Brief the method statement at the start of every shift." : null, dueDate: closed ? null : day(incident.day + 10), submittedForCloseAt: incident.status === "PENDING_CLOSE" ? at(-1, 15) : null, closedAt: closed ? at(incident.day + 9, 16) : null, closedByMemberId: closed ? lead : null, closureNote: closed ? "Actions complete; briefing recorded." : null, createdByMemberId: lead, createdAt: at(incident.day, 12) },
        });
      }
      if (incident.status === "PENDING_CLOSE") await prisma.hseApproval.upsert({ where: { id: `${id}_approval` }, update: {}, create: { id: `${id}_approval`, companyId: company, recordType: "INCIDENT_CLOSE", recordId: id, status: "PENDING", submittedByMemberId: lead, submittedAt: at(-1, 15) } });
    }

    // Permits to work.
    const PERMITS: Array<{ type: HsePermitType; title: string; status: HsePermitStatus; from: number; until: number }> = [
      { type: "EXCAVATION", title: `Excavation for drainage — ${r.pick(zones)}`, status: "CLOSED", from: -120 + si, until: -110 + si },
      { type: "HOT_WORK", title: `Welding of steel brackets — ${r.pick(zones)}`, status: "EXPIRED", from: -40, until: -38 },
      { type: si % 2 ? "ELECTRICAL" : "CONFINED_SPACE", title: si % 2 ? `Live connection of the temporary board — ${site.name}` : `Entry to the lift pit — ${site.name}`, status: "ACTIVE", from: -1, until: 2 },
      { type: "LIFTING", title: `Tandem lift of precast units — ${site.name}`, status: si % 2 ? "PENDING_APPROVAL" : "APPROVED", from: 3, until: 6 },
    ];
    for (const [index, permit] of PERMITS.entries()) {
      const id = `${P}ptw_${site.key}_${index + 1}`;
      const requested = m(site.supervisor, code);
      const approved = permit.status !== "PENDING_APPROVAL";
      const active = ["ACTIVE", "CLOSED", "EXPIRED"].includes(permit.status);
      if (!knownHse.has(id)) {
        await prisma.hseWorkPermit.create({
          data: { id, companyId: company, permitNumber: nextPermit(company), permitType: permit.type, title: permit.title, projectId: project, locationText: site.name, validFrom: at(permit.from, 7), validUntil: at(permit.until, 18), requestedByMemberId: requested, responsibleMemberId: requested, status: permit.status, hazardsSummary: "See the method statement attached to the permit.", controlsSummary: "Exclusion zone, competent person present, emergency arrangements briefed.", ppeRequirements: "Standard site PPE plus task-specific PPE on the method statement.", submittedAt: at(permit.from - 1, 15), approvedAt: approved ? at(permit.from - 1, 17) : null, approvedByMemberId: approved ? lead : null, activatedAt: active ? at(permit.from, 7) : null, closedAt: permit.status === "CLOSED" ? at(permit.until, 18) : null, closedByMemberId: permit.status === "CLOSED" ? lead : null, createdByMemberId: requested, createdAt: at(permit.from - 2, 10) },
        });
      }
      if (!approved) await prisma.hseApproval.upsert({ where: { id: `${id}_approval` }, update: {}, create: { id: `${id}_approval`, companyId: company, recordType: "WORK_PERMIT", recordId: id, status: "PENDING", submittedByMemberId: requested, submittedAt: at(permit.from - 1, 15) } });
    }
  }

  /* Quality ------------------------------------------------------------------------ */
  const nextQaInspection = series((await prisma.qualityInspection.findMany({ where: inGroup, select: { companyId: true, inspectionNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.inspectionNumber })), "INS");
  const nextNcr = series((await prisma.nonConformanceReport.findMany({ where: inGroup, select: { companyId: true, ncrNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.ncrNumber })), "NCR");
  const nextCa = series((await prisma.correctiveAction.findMany({ where: inGroup, select: { companyId: true, actionNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.actionNumber })), "CA");
  const nextDefect = series((await prisma.qualityDefect.findMany({ where: inGroup, select: { companyId: true, defectNumber: true } })).map((row) => ({ companyId: row.companyId, number: row.defectNumber })), "DEF");
  const knownQa = new Set([
    ...(await known((args) => prisma.qualityInspection.findMany(args))),
    ...(await known((args) => prisma.nonConformanceReport.findMany(args))),
    ...(await known((args) => prisma.correctiveAction.findMany(args))),
    ...(await known((args) => prisma.qualityDefect.findMany(args))),
  ]);
  for (const [si, site] of SITES.entries()) {
    const r = random(6_000 + si);
    const code = site.company;
    const company = companyId(code);
    const project = projectId(site.project);
    const inspector = m(site.qa, code);
    const approver = m(site.qaApprover, code);
    const zones = ZONES[site.key]!;
    const failedInspections: string[] = [];
    for (const [index, state] of QA_STATES.entries()) {
      const template = QA_TEMPLATES[(index + si) % QA_TEMPLATES.length]!;
      const offset = state === "DRAFT" ? r.int(2, 10) : state === "IN_PROGRESS" ? 0 : state === "PENDING_APPROVAL" ? -r.int(1, 4) : -r.int(10, 170);
      const id = `${P}qains_${site.key}_${index + 1}`;
      const status: QualityInspectionStatus = state === "CLOSED_PASS" || state === "CLOSED_FAIL" ? "CLOSED" : state;
      const fail = state === "CLOSED_FAIL";
      const decided = status === "CLOSED";
      const executed = status !== "DRAFT";
      const title = fill(template.title, { z: r.pick(zones), n: r.int(1, 10) });
      if (fail) failedInspections.push(id);
      if (!knownQa.has(id)) {
        await prisma.qualityInspection.create({
          data: { id, companyId: company, inspectionNumber: nextQaInspection(company), inspectionType: template.type, projectId: project, assignedInspectorMemberId: inspector, executedByMemberId: executed ? inspector : null, status, result: decided || status === "PENDING_APPROVAL" ? (fail ? "FAIL" : "PASS") : "NOT_SET", inspectionDate: executed ? at(offset, 9) : day(offset), submittedAt: status === "PENDING_APPROVAL" || decided ? at(offset, 14) : null, approvedAt: decided && !fail ? at(offset + 1, 10) : null, approvedByMemberId: decided && !fail ? approver : null, rejectedAt: fail ? at(offset + 1, 10) : null, rejectedByMemberId: fail ? approver : null, closedAt: decided ? at(offset + 1, 11) : null, closedByMemberId: decided ? approver : null, locationText: `${site.name} — ${r.pick(zones)}`, specificationReference: template.spec ?? null, summary: executed ? `${title}.` : null, decisionNote: fail ? "Rejected: out of tolerance; NCR raised." : null, createdByMemberId: inspector, createdAt: at(offset - 2, 9) },
        });
        const answered = decided || status === "PENDING_APPROVAL";
        await prisma.inspectionChecklistItem.createMany({
          data: template.checks.map((label, item) => {
            const result = answered ? (fail && item === 0 ? ("FAIL" as const) : ("PASS" as const)) : status === "IN_PROGRESS" && item === 0 ? ("PASS" as const) : null;
            return { id: `${id}_item_${item + 1}`, inspectionId: id, code: `Q${item + 1}`, label, responseType: "PASS_FAIL" as const, required: true, sortOrder: item, responseValue: result, result, note: result === "FAIL" ? "Measured and photographed; see the NCR." : null, requiresEvidenceOnFail: true };
          }),
          skipDuplicates: true,
        });
      }
      if (status === "PENDING_APPROVAL") await prisma.qualityApproval.upsert({ where: { id: `${id}_approval` }, update: {}, create: { id: `${id}_approval`, companyId: company, recordType: "INSPECTION", recordId: id, status: "PENDING", submittedByMemberId: inspector, submittedAt: at(offset, 14) } });
    }

    for (const [index, status] of NCR_STATES.entries()) {
      const template = NCR_TEMPLATES[(index + si) % NCR_TEMPLATES.length]!;
      const offset = status === "CLOSED" ? -r.int(60, 160) : -r.int(3, 30);
      const due = offset + r.int(10, 25);
      const id = `${P}ncr_${site.key}_${index + 1}`;
      const closed = status === "CLOSED";
      const assignee = m(site.engineer, code);
      if (!knownQa.has(id)) {
        await prisma.nonConformanceReport.create({
          data: { id, companyId: company, ncrNumber: nextNcr(company), title: fill(template.title, { z: r.pick(zones) }), description: template.description, projectId: project, inspectionId: index === 0 ? (failedInspections[0] ?? null) : null, category: template.category, severity: template.severity, status, assignedToMemberId: assignee, ownerMemberId: inspector, immediateAction: status === "OPEN" ? null : "Area held; no further work over it until corrected.", rootCause: ["CLOSED", "PENDING_APPROVAL", "PENDING_VERIFICATION"].includes(status) ? "Checks at hold points were skipped under programme pressure." : null, dueDate: day(due), submittedAt: at(offset, 15), approvedAt: closed ? at(due, 10) : null, approvedByMemberId: closed ? approver : null, closedAt: closed ? at(due, 11) : null, closedByMemberId: closed ? approver : null, closureNote: closed ? "Corrective work verified; evidence filed." : null, createdByMemberId: inspector, createdAt: at(offset, 15) },
        });
      }
      if (status === "PENDING_APPROVAL") await prisma.qualityApproval.upsert({ where: { id: `${id}_approval` }, update: {}, create: { id: `${id}_approval`, companyId: company, recordType: "NCR", recordId: id, status: "PENDING", submittedByMemberId: inspector, submittedAt: at(-1, 16) } });
      const caStatus: CorrectiveActionStatus = closed || status === "PENDING_APPROVAL" ? "VERIFIED" : status === "PENDING_VERIFICATION" ? "PENDING_VERIFICATION" : status === "IN_PROGRESS" ? "IN_PROGRESS" : "OPEN";
      const caId = `${P}ca_${site.key}_${index + 1}`;
      const done = caStatus === "PENDING_VERIFICATION" || caStatus === "VERIFIED";
      if (!knownQa.has(caId)) {
        await prisma.correctiveAction.create({
          data: { id: caId, companyId: company, actionNumber: nextCa(company), title: template.action, description: `${template.action}; record the result on the NCR.`, ncrId: id, projectId: project, assignedToMemberId: assignee, dueDate: day(due), status: caStatus, completionNote: done ? "Done; photos and measurements filed." : null, completedAt: done ? at(Math.min(due - 1, 0), 16) : null, completedByMemberId: done ? assignee : null, verificationNote: caStatus === "VERIFIED" ? "Checked on site; within tolerance." : null, verifiedAt: caStatus === "VERIFIED" ? at(Math.min(due, 0), 10) : null, verifiedByMemberId: caStatus === "VERIFIED" ? inspector : null, createdByMemberId: inspector, createdAt: at(offset + 1, 16) },
        });
      }
    }

    for (let index = 0; index < 6; index += 1) {
      const status = DEFECT_STATES[(index + si) % DEFECT_STATES.length]!;
      const offset = status === "CLOSED" ? -r.int(30, 120) : -r.int(1, 25);
      const due = offset + r.int(7, 21);
      const id = `${P}def_${site.key}_${index + 1}`;
      const resolved = status === "RESOLVED" || status === "CLOSED";
      const assignee = m(site.engineer, code);
      if (!knownQa.has(id)) {
        await prisma.qualityDefect.create({
          data: { id, companyId: company, defectNumber: nextDefect(company), title: `${DEFECTS[(index + si) % DEFECTS.length]} — ${r.pick(zones)}`, description: "Found on the snagging walk; photographed and marked.", projectId: project, severity: index % 4 === 0 ? "MEDIUM" : "LOW", status, locationText: `${site.name} — ${r.pick(zones)}`, assignedToMemberId: assignee, dueDate: day(due), resolvedAt: resolved ? at(Math.min(due - 1, 0), 15) : null, resolvedByMemberId: resolved ? assignee : null, resolutionNote: resolved ? "Made good and checked." : status === "REOPENED" ? "Reopened: the repair did not hold." : null, closedAt: status === "CLOSED" ? at(Math.min(due, 0), 16) : null, closedByMemberId: status === "CLOSED" ? inspector : null, createdByMemberId: inspector, createdAt: at(offset, 11) },
        });
      }
    }
  }

  /* Legal ---------------------------------------------------------------------------- */
  const OWN_NAME: Partial<Record<CompanyCode, string>> = { [BCI]: "BUILDING CONSTRUCTION INVEST", [ALN]: "ARLIS - NDERTIM", [IDEAL]: "IDEAL Construction", [SMI]: "Saranda Marina Invest", [ARSOL]: "ARSOL ENERGY", [UNICO]: "UNICO CONSTRUCTION" };
  const COUNSEL: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.legal", [ALN]: "arlis.legal", [ARSOL]: "arsol.legal", [IDEAL]: "armaar.legal", [SMI]: "armaar.legal", [UNICO]: "armaar.legal" };
  const CONTRACTS: Array<{ key: string; company: CompanyCode; project: ProjectCode | null; number: string; title: string; type: ContractType; counterparty: string; value: number | null; status: ContractStatus; signed: number | null; term?: number; summary: string }> = [
    { key: "bci_security", company: BCI, project: "TIRANA_LAKE", number: "BCI-SV-2026-011", title: "Site security services — Tirana Lake", type: "SERVICE_AGREEMENT", counterparty: "Demo Security Services sh.p.k.", value: 124_800, status: "ACTIVE", signed: -160, term: 365, summary: "Twenty-four-hour guarding and access control for the site." },
    { key: "bci_lease_retail", company: BCI, project: "TIRANA_LAKE", number: "BCI-LS-2026-012", title: "Lease — podium retail unit R-03", type: "LEASE", counterparty: "Nord Coffee Co. sh.p.k.", value: 216_000, status: "SIGNED", signed: -12, term: 1_825, summary: "Five-year lease of unit R-03 from handover, rent-free fit-out period of three months." },
    { key: "bci_lease_clinic", company: BCI, project: "TIRANA_LAKE", number: "BCI-LS-2026-013", title: "Lease — podium unit R-07, dental clinic", type: "LEASE", counterparty: "Metro Dental Clinics sh.p.k.", value: 162_000, status: "PENDING_APPROVAL", signed: null, summary: "Five-year lease of unit R-07 with a break at year three." },
    { key: "bci_facade_consult", company: BCI, project: "TIRANA_LAKE", number: "BCI-CS-2026-014", title: "Façade consultancy — Tower B", type: "CONSULTING", counterparty: "Demo Façade Engineering sh.p.k.", value: 28_000, status: "IN_REVIEW", signed: null, summary: "Inspection and sign-off of the Tower B curtain wall." },
    { key: "aln_nda", company: ALN, project: null, number: "ALN-NDA-2026-0004", title: "Non-disclosure agreement — land acquisition, Kashar", type: "NDA", counterparty: "Demo Land Holdings sh.p.k.", value: null, status: "EXPIRED", signed: -400, term: 365, summary: "Confidentiality for the Kashar land discussions." },
    { key: "ideal_demolition", company: IDEAL, project: "EYES_OF_TIRANA", number: "IDEAL-SC-2026-0001", title: "Demolition subcontract — Eyes of Tirana", type: "SUBCONTRACT", counterparty: "AlbaBuild sh.p.k.", value: 148_000, status: "ACTIVE", signed: -30, term: 120, summary: "Demolition and clearance of the existing structures, with asbestos removal." },
    { key: "ideal_prelet", company: IDEAL, project: "EYES_OF_TIRANA", number: "IDEAL-LS-2026-0002", title: "Agreement for lease — ground-floor retail", type: "LEASE", counterparty: "Eyes of Tirana Retail Partners sh.p.k.", value: 540_000, status: "SENT", signed: null, summary: "Agreement for lease of the ground-floor retail on completion." },
    { key: "unico_operator_hoa", company: UNICO, project: "UNITED_TOWERS", number: "UNICO-CA-2026-0002", title: "Heads of terms — hotel operator, United Towers", type: "CLIENT_AGREEMENT", counterparty: "Demo Hospitality Group", value: null, status: "DRAFT", signed: null, summary: "Heads of terms for the management agreement of the upper-floor hotel." },
    { key: "unico_wind", company: UNICO, project: "UNITED_TOWERS", number: "UNICO-CS-2026-0003", title: "Wind-tunnel testing agreement", type: "CONSULTING", counterparty: "Demo Wind Engineering Ltd", value: 54_000, status: "ACTIVE", signed: -82, term: 150, summary: "Wind-tunnel testing of façade pressures and pedestrian comfort." },
    { key: "smi_marine", company: SMI, project: "CLEARWATER_BEACH", number: "SMI-SV-2026-004", title: "Breakwater design services — Clearwater Beach", type: "SERVICE_AGREEMENT", counterparty: "Vlora Marine Works sh.p.k.", value: 88_000, status: "APPROVED", signed: null, summary: "Design of the breakwater and the marine permit drawings." },
    { key: "arsol_ppa_2", company: ARSOL, project: null, number: "ARSOL-PPA-2026-003", title: "Power purchase agreement — Durrës logistics hub", type: "CLIENT_AGREEMENT", counterparty: "Durrës Logistics Hub sh.p.k.", value: 780_000, status: "ACTIVE", signed: -95, term: 5_475, summary: "Fifteen years of power from 650 kWp on the hub's warehouses." },
    { key: "arsol_ppa_3", company: ARSOL, project: null, number: "ARSOL-PPA-2026-004", title: "Power purchase agreement — Elbasan cold store", type: "CLIENT_AGREEMENT", counterparty: "Elbasan Agro Cold Store sh.p.k.", value: 410_000, status: "PENDING_APPROVAL", signed: null, summary: "Twelve years of power from 380 kWp with a battery option." },
    { key: "arsol_om_old", company: ARSOL, project: null, number: "ARSOL-SV-2025-005", title: "O&M agreement — rooftop batch 1, year 1", type: "SERVICE_AGREEMENT", counterparty: "Demo Solar Services sh.p.k.", value: 38_000, status: "TERMINATED", signed: -500, term: 365, summary: "Replaced by the year-2 agreement after a service-level dispute." },
  ];
  const knownContracts = await known((args) => prisma.contract.findMany(args));
  for (const contract of CONTRACTS) {
    const code = contract.company;
    const id = `${P}contract_${contract.key}`;
    const counsel = m(COUNSEL[code]!, code);
    const live = ["ACTIVE", "COMPLETED", "EXPIRED", "TERMINATED"].includes(contract.status);
    if (!knownContracts.has(id)) {
      await prisma.contract.create({
        data: { id, companyId: companyId(code), contractNumber: contract.number, title: contract.title, contractType: contract.type, projectId: contract.project ? projectId(contract.project) : null, ownerMemberId: counsel, status: contract.status, counterpartyName: contract.counterparty, currency: contract.value === null ? null : EUR, contractValue: contract.value === null ? null : money(contract.value), signedDate: contract.signed === null ? null : day(contract.signed), effectiveDate: live && contract.signed !== null ? day(contract.signed + 1) : null, expiryDate: contract.signed !== null && contract.term ? day(contract.signed + contract.term) : null, renewalType: "NONE", governingLaw: "Albanian law", jurisdiction: code === SMI ? "Sarandë" : "Tirana", summary: contract.summary, createdByMemberId: counsel, createdAt: at((contract.signed ?? -3) - 20) },
      });
    }
    for (const [role, name, primary] of [["OUR_COMPANY", OWN_NAME[code]!, false], [contract.type === "CLIENT_AGREEMENT" || contract.type === "LEASE" ? "CLIENT" : "COUNTERPARTY", contract.counterparty, true]] as const) {
      const partyId = `${id}_party_${role.toLowerCase()}`;
      await prisma.contractParty.upsert({ where: { id: partyId }, update: {}, create: { id: partyId, companyId: companyId(code), contractId: id, partyRole: role, partyType: "COMPANY", name, legalName: name, city: "Tirana", country: "Albania", isPrimaryCounterparty: primary } });
    }
    if (contract.status === "PENDING_APPROVAL" || contract.status === "APPROVED") {
      const pending = contract.status === "PENDING_APPROVAL";
      await prisma.contractApproval.upsert({ where: { id: `${id}_approval` }, update: {}, create: { id: `${id}_approval`, companyId: companyId(code), recordType: "CONTRACT", recordId: id, status: pending ? "PENDING" : "APPROVED", submittedByMemberId: counsel, submittedAt: at(-4, 11), decidedByMemberId: pending ? null : m(DIRECTOR[code]!, code), decidedAt: pending ? null : at(-2, 10), decisionNote: pending ? null : "Terms as negotiated." } });
    }
  }
  // Obligations: on the new contracts and on those already there.
  const OBLIGATIONS: Array<{ contract: string; company: CompanyCode; title: string; type: "PAYMENT" | "DELIVERABLE" | "COMPLIANCE" | "NOTICE" | "DOCUMENT" | "RENEWAL"; responsible: string; due: number; state: "OPEN" | "COMPLETED" | "CANCELLED" }> = [
    { contract: `${P}contract_bci_security`, company: BCI, title: "Monthly guarding report", type: "DELIVERABLE", responsible: "bci.pm", due: 2, state: "OPEN" },
    { contract: `${P}contract_bci_security`, company: BCI, title: "Invoice for August services", type: "PAYMENT", responsible: "bci.finance", due: -25, state: "COMPLETED" },
    { contract: `${P}contract_bci_lease_retail`, company: BCI, title: "Hand over unit R-03 for fit-out", type: "DELIVERABLE", responsible: "bci.pm", due: 21, state: "OPEN" },
    { contract: `${P}contract_bci_lease_retail`, company: BCI, title: "Tenant's rent deposit received", type: "PAYMENT", responsible: "bci.finance", due: -5, state: "COMPLETED" },
    { contract: `${P}contract_bci_lease_retail`, company: BCI, title: "Tenant's fit-out drawings for approval", type: "DOCUMENT", responsible: "bci.architect", due: 35, state: "OPEN" },
    { contract: `${P}contract_aln_precast`, company: ALN, title: "Delivery schedule for Block C stairs", type: "DOCUMENT", responsible: "arlis.pm-lead", due: -3, state: "OPEN" },
    { contract: `${P}contract_aln_precast`, company: ALN, title: "Product liability insurance certificate", type: "COMPLIANCE", responsible: "arlis.legal", due: -40, state: "COMPLETED" },
    { contract: `${P}contract_aln_agency`, company: ALN, title: "Final account agreed", type: "PAYMENT", responsible: "arlis.finance", due: -20, state: "COMPLETED" },
    { contract: `${P}contract_ideal_demolition`, company: IDEAL, title: "Asbestos clearance certificate", type: "COMPLIANCE", responsible: "ideal.hse", due: 14, state: "OPEN" },
    { contract: `${P}contract_ideal_demolition`, company: IDEAL, title: "Notice to neighbours, seven days before start", type: "NOTICE", responsible: "ideal.pm", due: -24, state: "COMPLETED" },
    { contract: `${P}contract_unico_wind`, company: UNICO, title: "Final wind-tunnel report", type: "DELIVERABLE", responsible: "unico.engineering", due: 45, state: "OPEN" },
    { contract: `${P}contract_unico_wind`, company: UNICO, title: "Second stage payment", type: "PAYMENT", responsible: "unico.finance", due: -10, state: "OPEN" },
    { contract: `${P}contract_arsol_ppa_2`, company: ARSOL, title: "Commissioning certificate", type: "DOCUMENT", responsible: "arsol.electrical", due: -60, state: "COMPLETED" },
    { contract: `${P}contract_arsol_ppa_2`, company: ARSOL, title: "Quarterly generation statement", type: "DELIVERABLE", responsible: "arsol.pm", due: 10, state: "OPEN" },
    { contract: `${P}contract_arsol_om_old`, company: ARSOL, title: "Year-end availability report", type: "DELIVERABLE", responsible: "arsol.pm", due: -130, state: "CANCELLED" },
    { contract: "armaar_contract_construction_tl", company: BCI, title: "Interim payment certificate no. 19", type: "PAYMENT", responsible: "bci.finance", due: 27, state: "OPEN" },
    { contract: "armaar_contract_construction_tl", company: BCI, title: "Monthly progress report — August", type: "DELIVERABLE", responsible: "bci.pm", due: -25, state: "COMPLETED" },
    { contract: "armaar_contract_construction_tl", company: BCI, title: "Interim payment certificate no. 17", type: "PAYMENT", responsible: "bci.finance", due: -33, state: "COMPLETED" },
    { contract: "armaar_contract_sub_vlora_glass", company: BCI, title: "Curtain wall warranty — draft for review", type: "DOCUMENT", responsible: "bci.legal", due: 60, state: "OPEN" },
    { contract: "armaar_contract_framework_steel", company: BCI, title: "Quarterly price review — Q2", type: "NOTICE", responsible: "bci.procurement", due: -78, state: "COMPLETED" },
    { contract: "armaar_legal_design_ut", company: UNICO, title: "Stage 3 design report", type: "DELIVERABLE", responsible: "unico.engineering", due: 75, state: "OPEN" },
    { contract: "armaar_legal_framework_pv", company: ARSOL, title: "Call-off price revision", type: "NOTICE", responsible: "arsol.procurement", due: 18, state: "OPEN" },
    { contract: "armaar_legal_service_lifts_s21", company: ALN, title: "Annual lift safety certificate", type: "COMPLIANCE", responsible: "arlis.legal", due: -15, state: "OPEN" },
  ];
  const presentContracts = new Set((await prisma.contract.findMany({ where: { id: { in: OBLIGATIONS.map((row) => row.contract) } }, select: { id: true } })).map((row) => row.id));
  for (const [index, obligation] of OBLIGATIONS.entries()) {
    if (!presentContracts.has(obligation.contract)) continue;
    const code = obligation.company;
    const id = `${P}obl_${String(index + 1).padStart(2, "0")}`;
    await prisma.contractObligation.upsert({
      where: { id },
      update: {},
      create: { id, companyId: companyId(code), contractId: obligation.contract, title: obligation.title, obligationType: obligation.type, responsibleMemberId: m(obligation.responsible, code), dueDate: day(obligation.due), status: obligation.state, completedAt: obligation.state === "COMPLETED" ? at(obligation.due - 1, 15) : null, createdByMemberId: m(COUNSEL[code]!, code), createdAt: at(Math.min(obligation.due, 0) - 30) },
    });
  }
  const AMENDMENTS = [
    { id: `${P}amd_bci_security_1`, company: BCI, contract: `${P}contract_bci_security`, number: "AMD-001", title: "Extra night patrol during the curtain-wall lifts", summary: "One additional guard at night for three months; +€9,600.", status: "ACTIVE" as const, delta: 9_600, previous: 124_800, day: -40 },
    { id: `${P}amd_ideal_demolition_1`, company: IDEAL, contract: `${P}contract_ideal_demolition`, number: "AMD-001", title: "Basement slab break-out", summary: "Break-out of the old basement slab found during demolition; +€21,000.", status: "PENDING_APPROVAL" as const, delta: 21_000, previous: 148_000, day: -3 },
  ];
  for (const amendment of AMENDMENTS) {
    const counsel = m(COUNSEL[amendment.company]!, amendment.company);
    const active = amendment.status === "ACTIVE";
    await prisma.contractAmendment.upsert({
      where: { id: amendment.id },
      update: {},
      create: { id: amendment.id, companyId: companyId(amendment.company), contractId: amendment.contract, amendmentNumber: amendment.number, title: amendment.title, summary: amendment.summary, status: amendment.status, signedDate: active ? day(amendment.day) : null, effectiveDate: active ? day(amendment.day + 1) : null, activatedAt: active ? at(amendment.day + 1, 9) : null, valueDelta: money(amendment.delta), previousContractValue: active ? money(amendment.previous) : null, newContractValue: active ? money(amendment.previous + amendment.delta) : null, createdByMemberId: counsel, createdAt: at(amendment.day - 5) },
    });
    if (active) await prisma.contract.updateMany({ where: { id: amendment.contract, contractValue: money(amendment.previous) }, data: { contractValue: money(amendment.previous + amendment.delta) } });
    if (amendment.status === "PENDING_APPROVAL") await prisma.contractApproval.upsert({ where: { id: `${amendment.id}_approval` }, update: {}, create: { id: `${amendment.id}_approval`, companyId: companyId(amendment.company), recordType: "AMENDMENT", recordId: amendment.id, status: "PENDING", submittedByMemberId: counsel, submittedAt: at(amendment.day, 11) } });
  }

  /* Documents -------------------------------------------------------------------------- */
  const DOCS: Array<{ site: string; name: string; by: string }> = [];
  for (const site of SITES) {
    for (let week = 1; week <= 4; week += 1) DOCS.push({ site: site.key, name: `Site report — ${site.name}, week ${39 - week * 3}.pdf`, by: site.engineer });
    for (const offset of [-150, -120, -90, -60, -30]) DOCS.push({ site: site.key, name: `HSE monthly report — ${site.name}, ${monthOf(offset)}.pdf`, by: site.hse });
    DOCS.push({ site: site.key, name: `QA/QC register — ${site.name}, Q3.xlsx`, by: site.qa });
    DOCS.push({ site: site.key, name: `Progress meeting minutes — ${site.name}, ${monthOf(-15)}.pdf`, by: site.supervisor });
    DOCS.push({ site: site.key, name: `Programme update — ${site.name}, rev ${String.fromCharCode(67 + SITES.indexOf(site) % 3)}.pdf`, by: site.supervisor });
  }
  const knownDocuments = await known((args) => prisma.document.findMany(args));
  for (const [index, doc] of DOCS.entries()) {
    const site = SITES.find((row) => row.key === doc.site)!;
    const id = `${P}doc_${site.key}_${String(index + 1).padStart(3, "0")}`;
    if (knownDocuments.has(id)) continue;
    await seedStoredDocument(prisma, { id, companyId: companyId(site.company), name: doc.name, projectId: projectId(site.project), entityType: "project", entityId: projectId(site.project), uploadedByMemberId: m(doc.by, site.company), createdBy: userId(doc.by) });
    await prisma.document.update({ where: { id }, data: { createdAt: at(-170 + (index % 30) * 5 + SITES.indexOf(site)) } });
  }

  /* Announcements ------------------------------------------------------------------------ */
  const ANNOUNCEMENTS: Array<{ key: string; company: CompanyCode; by: string; title: string; body: string; status: AnnouncementStatus; priority: AnnouncementPriority; audience: "COMPANY" | "PROJECT" | "SELECTED_MEMBERS"; project?: ProjectCode; day: number; pinned?: true; ack?: true; expires?: number; selected?: string[] }> = [
    { key: "bci_holiday", company: BCI, by: "bci.director", title: "Office hours over the Independence Day holidays", body: "Offices close on 28 and 29 November. Sites work to the holiday rota the project managers circulate.", status: "SCHEDULED", priority: "NORMAL", audience: "COMPANY", day: 30 },
    { key: "bci_ppe_policy", company: BCI, by: "bci.director", title: "Cut-resistant gloves are now mandatory for steel fixing", body: "After the tie-wire injuries, every steel fixer wears level C gloves from Monday. Please read and acknowledge.", status: "PUBLISHED", priority: "IMPORTANT", audience: "COMPANY", day: -10, ack: true },
    { key: "tl_crane", company: BCI, by: "bci.pm", title: "Tower crane TC-1 out of service on Saturday", body: "Annual thorough examination on Saturday. No lifts on Tower A that day.", status: "EXPIRED", priority: "NORMAL", audience: "PROJECT", project: "TIRANA_LAKE", day: -40, expires: -36 },
    { key: "bci_q3_close", company: BCI, by: "bci.finance", title: "Q3 close — expenses by 5 October", body: "Submit every September expense and supplier invoice by 5 October so Q3 closes on time.", status: "PUBLISHED", priority: "NORMAL", audience: "SELECTED_MEMBERS", day: -1, selected: ["bci.pm", "bci.pm-lead", "bci.procurement", "bci.finance-specialist"] },
    { key: "aln_summer_hours", company: ALN, by: "arlis.director", title: "Summer working hours end", body: "From 1 October sites return to 07:30–16:30.", status: "EXPIRED", priority: "NORMAL", audience: "COMPANY", day: -35, expires: -1 },
    { key: "aln_audit", company: ALN, by: "arlis.hse", title: "ISO 45001 surveillance audit next month", body: "The certification body visits ARLIS - NDERTIM's sites. Registers, permits and training records must be current.\n\nPlease acknowledge.", status: "PUBLISHED", priority: "IMPORTANT", audience: "COMPANY", day: -4, ack: true, pinned: true },
    { key: "aln_old_canteen", company: ALN, by: "arlis.director", title: "Canteen moves to the new site cabins", body: "The site canteen has moved to the cabins by gate 2.", status: "ARCHIVED", priority: "NORMAL", audience: "COMPANY", day: -120 },
    { key: "ideal_kickoff", company: IDEAL, by: "ideal.director", title: "Eyes of Tirana — early works start", body: "Demolition starts on site this month. Neighbours have been notified; complaints go to the project manager.", status: "PUBLISHED", priority: "IMPORTANT", audience: "COMPANY", day: -28 },
    { key: "unico_design_freeze", company: UNICO, by: "unico.director", title: "United Towers — design freeze at stage 3", body: "The stage 3 design freezes on 31 October. Changes after that go through the change log.", status: "PUBLISHED", priority: "NORMAL", audience: "COMPANY", day: -7, pinned: true },
    { key: "unico_draft", company: UNICO, by: "unico.coordinator", title: "Site induction for the piling contractor", body: "Draft: induction schedule and site rules for the piling crews.", status: "DRAFT", priority: "NORMAL", audience: "PROJECT", project: "UNITED_TOWERS", day: -1 },
    { key: "smi_season", company: SMI, by: "smi.director", title: "Beach works stop for the tourist season", body: "No works on the beach frontage until 15 September. The hotel block continues.", status: "EXPIRED", priority: "IMPORTANT", audience: "COMPANY", day: -130, expires: -15 },
    { key: "smi_storm", company: SMI, by: "smi.pm", title: "Storm warning — secure loose materials tonight", body: "Gale-force winds are forecast from 20:00. Secure sheets, boards and the site hoarding before leaving.", status: "PUBLISHED", priority: "CRITICAL", audience: "PROJECT", project: "CLEARWATER_BEACH", day: -1 },
    { key: "arsol_record", company: ARSOL, by: "arsol.director", title: "Record generation in August", body: "The rooftop programme generated 214 MWh in August, our best month yet. Thank you all.", status: "PUBLISHED", priority: "NORMAL", audience: "COMPANY", day: -25 },
    { key: "arsol_safety", company: ARSOL, by: "arsol.pm", title: "Roof access procedure updated", body: "Every roof visit now needs a second person and a signed access log. Please acknowledge.", status: "SCHEDULED", priority: "IMPORTANT", audience: "COMPANY", day: 3, ack: true },
  ];
  const companyMembers = new Map<string, string[]>();
  for (const code of [BCI, ALN, IDEAL, UNICO, SMI, ARSOL]) {
    await prisma.productivitySettings.upsert({ where: { companyId: companyId(code) }, update: {}, create: { companyId: companyId(code) } });
    companyMembers.set(code, (await prisma.companyMember.findMany({ where: { companyId: companyId(code), status: "ACTIVE" }, orderBy: { id: "asc" }, select: { id: true } })).map((row) => row.id));
  }
  for (const announcement of ANNOUNCEMENTS) {
    const code = announcement.company;
    const id = `${P}ann_${announcement.key}`;
    const author = m(announcement.by, code);
    const published = ["PUBLISHED", "EXPIRED", "ARCHIVED"].includes(announcement.status);
    await prisma.announcement.upsert({
      where: { id },
      update: {},
      create: { id, companyId: companyId(code), status: announcement.status, title: announcement.title, body: announcement.body, priority: announcement.priority, audienceType: announcement.audience, projectId: announcement.project ? projectId(announcement.project) : null, authorMemberId: author, publishedByMemberId: published ? author : null, publishAt: announcement.status === "SCHEDULED" ? at(announcement.day, 8) : null, publishedAt: published ? at(announcement.day, 8) : null, expiresAt: announcement.expires !== undefined ? at(announcement.expires, 23) : null, expiredAt: announcement.status === "EXPIRED" ? at(announcement.expires ?? announcement.day + 7, 23) : null, archivedAt: announcement.status === "ARCHIVED" ? at(announcement.day + 30, 9) : null, pinned: announcement.pinned ?? false, requiresAcknowledgment: announcement.ack ?? false, createdAt: at(announcement.day - 1, 16) },
    });
    const audience = announcement.selected ? announcement.selected.map((username) => m(username, code)) : (companyMembers.get(code) ?? []).filter((member) => member !== author);
    if (announcement.selected) await prisma.announcementAudienceMember.createMany({ data: audience.map((memberId) => ({ announcementId: id, memberId })), skipDuplicates: true });
    if (!published) continue;
    if (announcement.ack) {
      await prisma.announcementTarget.createMany({ data: audience.map((memberId) => ({ announcementId: id, memberId, targetedAt: at(announcement.day, 8) })), skipDuplicates: true });
      await prisma.announcementAcknowledgment.createMany({ data: audience.filter((_, index) => index % 3 !== 0).map((memberId) => ({ announcementId: id, memberId, acknowledgedAt: at(Math.min(announcement.day + 1, 0), 10) })), skipDuplicates: true });
    }
    await prisma.announcementRead.createMany({ data: audience.filter((_, index) => index % 2 === 0 || announcement.ack).map((memberId) => ({ announcementId: id, memberId, firstReadAt: at(Math.min(announcement.day + 1, 0), 9), lastReadAt: at(Math.min(announcement.day + 1, 0), 9) })), skipDuplicates: true });
  }

  return {
    leave: await prisma.leaveRequest.count({ where: inGroup }),
    leaveWritten: leaveCount,
    balances: await prisma.leaveBalance.count({ where: inGroup }),
    hseInspections: await prisma.hseInspection.count({ where: inGroup }),
    hazards: await prisma.hseHazard.count({ where: inGroup }),
    hseActions: await prisma.hseAction.count({ where: inGroup }),
    talks: await prisma.toolboxTalk.count({ where: inGroup }),
    incidents: await prisma.hseIncident.count({ where: inGroup }),
    permits: await prisma.hseWorkPermit.count({ where: inGroup }),
    qaInspections: await prisma.qualityInspection.count({ where: inGroup }),
    ncrs: await prisma.nonConformanceReport.count({ where: inGroup }),
    correctiveActions: await prisma.correctiveAction.count({ where: inGroup }),
    defects: await prisma.qualityDefect.count({ where: inGroup }),
    contracts: await prisma.contract.count({ where: { ...inGroup, contractType: { not: "SALE_AGREEMENT" } } }),
    obligations: await prisma.contractObligation.count({ where: inGroup }),
    documents: await prisma.document.count({ where: inGroup }),
    announcements: await prisma.announcement.count({ where: inGroup }),
  };
}
