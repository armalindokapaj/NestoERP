/**
 * The site's record of itself: each project's phases and milestones on the
 * programme, a month of daily logs from every site that is building (weather,
 * who was there, what got done, plant, deliveries, delays, visitors,
 * instructions), the team's tasks, and each company's calendar.
 */
import type { DailyLogDelayCategory, DailyLogSiteCondition, DailyLogStatus, DailyLogWeatherCondition, Prisma, PrismaClient, ProjectMilestoneStatus, ProjectMilestoneType, ProjectPhaseStatus, TaskPriority, TaskStatus } from "@prisma/client";

import { at, businessDay, castOf, DAY, random, type Cast, type Clock, type Part, type Random } from "./kit";
import { PROJECT_DATES } from "./sales";

type SiteProfile = {
  projectId: string;
  companyId: string;
  /** What the site is doing this month, for the daily logs. */
  work: string[];
  areas: string[];
  plant: string[];
  logs: boolean;
};

const SITES: SiteProfile[] = [
  { projectId: "project_a", companyId: "company_demo_a", logs: true, areas: ["Block A", "Block B", "Block C", "Basement 2"], plant: ["Tower crane TC-1", "Tower crane TC-2", "Concrete pump 42 m", "Telehandler"], work: ["Rebar fixing, Block C level 6 slab", "Formwork striking, Block C level 5", "Blockwork, Block B levels 4–5", "Window installation, Block A floors 1–3", "Screed, Block A level 2", "Waterproofing, Block B roof", "MEP first fix, Block A levels 3–4"] },
  { projectId: "project_b", companyId: "company_demo_b", logs: true, areas: ["Core", "Level 9", "Level 10", "Basement 1", "Podium"], plant: ["Tower crane TC-1", "Concrete pump 36 m", "Hoist H-1"], work: ["Core walls climbing to level 11", "Level 10 slab, rebar and post-tension ducts", "Level 9 formwork striking", "Podium waterproofing", "Basement MEP sleeves", "Lobby fit-out handover to the contractor"] },
  { projectId: "project_c", companyId: "company_demo_c", logs: true, areas: ["Warehouse A", "Truck yard", "Service building", "North boundary"], plant: ["Excavator CAT 330", "Mobile crane 60 t", "Pile rig", "Roller 12 t"], work: ["Pad foundations, Warehouse A gridlines 5–9", "Portal frame erection, bays 1–3", "Yard sub-base and compaction", "Drainage trench, north boundary", "Service building ground slab"] },
  { projectId: "project_d", companyId: "company_demo_d", logs: true, areas: ["Block A", "Block B", "Promenade", "Basement"], plant: ["Tower crane TC-1", "Hoist H-1", "Scissor lift"], work: ["Block B core, level 9 walls", "Block A window installation, floors 6–8", "Block A plastering, floors 1–3", "Promenade paving set-out", "Basement ventilation ducts"] },
  { projectId: "project_e", companyId: "company_demo_e", logs: true, areas: ["Hotel", "Residences R1", "Residences R2", "Beach road"], plant: ["Tower crane TC-1", "Excavator JCB 220", "Concrete pump 36 m"], work: ["Hotel level 2 columns and slab", "Residences R1 foundations 5–8", "R2 excavation and blinding", "Beach-road access traffic management", "Hotel basement waterproofing"] },
  { projectId: "project_showcase_promenada", companyId: "company_demo_b", logs: true, areas: ["Block A", "Block B", "Seafront shops"], plant: ["Tower crane TC-1", "Hoist H-1", "Scissor lift"], work: ["Block A tiling, floors 4–6", "Block A kitchens, floors 1–3", "Block B structure, level 7 slab", "Seafront shop fronts", "Lift installation, Block A"] },
];

/** The phases of a building project, as fractions of its time from start to handover. */
const PHASES: Array<{ name: string; from: number; to: number; description: string }> = [
  { name: "Design and permits", from: -0.2, to: 0.04, description: "Design development, the building permit and the bank's approval." },
  { name: "Enabling works", from: 0.02, to: 0.12, description: "Site set-up, demolition, diversions and the excavation." },
  { name: "Substructure", from: 0.1, to: 0.3, description: "Piles, foundations, basement walls and the ground slab." },
  { name: "Superstructure", from: 0.25, to: 0.62, description: "Frame and slabs to the roof." },
  { name: "Envelope", from: 0.48, to: 0.8, description: "Façade, windows and the roof, to watertight." },
  { name: "MEP and finishes", from: 0.58, to: 0.95, description: "Services, plaster, screeds, tiling and joinery." },
  { name: "Commissioning and handover", from: 0.92, to: 1, description: "Testing, the occupancy certificate and handover to buyers." },
];

const MILESTONES: Array<{ name: string; type: ProjectMilestoneType; at: number; phase: number; critical?: boolean; external?: boolean }> = [
  { name: "Building permit granted", type: "APPROVAL", at: 0, phase: 0, critical: true, external: true },
  { name: "Ground-breaking", type: "PROJECT_START", at: 0.03, phase: 1 },
  { name: "Excavation complete", type: "CONSTRUCTION", at: 0.12, phase: 1 },
  { name: "Ground slab poured", type: "CONSTRUCTION", at: 0.29, phase: 2, critical: true },
  { name: "Topping out", type: "CONSTRUCTION", at: 0.62, phase: 3, critical: true, external: true },
  { name: "Watertight", type: "CONSTRUCTION", at: 0.8, phase: 4, critical: true },
  { name: "MEP commissioned", type: "COMMISSIONING", at: 0.93, phase: 5 },
  { name: "Occupancy certificate", type: "APPROVAL", at: 0.97, phase: 6, critical: true, external: true },
  { name: "Handover to buyers", type: "HANDOVER", at: 1, phase: 6, critical: true, external: true },
];

export async function seedShowcaseSite(prisma: PrismaClient, clock: Clock) {
  const totals = { phases: 0, milestones: 0, logs: 0, tasks: 0, events: 0 };
  // Every project but Kalaja, whose programme the standard seed already has.
  for (const [projectId, dates] of Object.entries(PROJECT_DATES)) {
    if (projectId === "project_a") continue;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true } });
    const cast = await castOf(prisma, project.companyId!);
    const planned = await planProject(prisma, clock, cast, projectId, dates.start, dates.end);
    totals.phases += planned.phases;
    totals.milestones += planned.milestones;
  }
  for (const site of SITES) {
    const cast = await castOf(prisma, site.companyId);
    const rand = random(`site:${site.projectId}`);
    const contractors = await prisma.projectContractorAssignment.findMany({ where: { projectId: site.projectId, status: "ACTIVE" }, select: { contractor: { select: { tradingName: true, legalName: true } } } });
    if (site.logs) totals.logs += await dailyLogs(prisma, clock, cast, site, rand, contractors.map((row) => row.contractor.tradingName ?? row.contractor.legalName));
  }
  for (const [projectId, tasks] of Object.entries(TASKS)) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true } });
    const cast = await castOf(prisma, project.companyId!);
    totals.tasks += await addTasks(prisma, clock, cast, projectId, tasks, random(`tasks:${projectId}`));
  }
  for (const companyId of ["company_demo_a", "company_demo_b", "company_demo_c", "company_demo_d", "company_demo_e"]) {
    totals.events += await calendar(prisma, clock, await castOf(prisma, companyId));
  }
  return totals;
}

/* -------------------------------------------------------------------------- */
/* Programme                                                                   */
/* -------------------------------------------------------------------------- */

async function planProject(prisma: PrismaClient, clock: Clock, cast: Cast, projectId: string, start: number, end: number) {
  const span = end - start;
  const day = (fraction: number) => Math.round(start + fraction * span);
  const rand = random(`plan:${projectId}`);
  const phaseIds: string[] = [];
  for (const [index, phase] of PHASES.entries()) {
    const from = day(phase.from);
    const to = day(phase.to);
    const done = to < -3;
    const running = !done && from <= 0;
    // The phase under way runs a little late on the bigger sites.
    const late = running && rand.chance(0.4);
    const status: ProjectPhaseStatus = done ? "COMPLETED" : running ? (late ? "AT_RISK" : "IN_PROGRESS") : "NOT_STARTED";
    const id = `phase_${projectId}_${index + 1}`;
    await prisma.projectPhase.create({
      data: {
        id, companyId: cast.companyId, projectId, name: phase.name, description: phase.description, sortOrder: index + 1,
        plannedStartDate: businessDay(clock, from), plannedEndDate: businessDay(clock, to),
        forecastStartDate: businessDay(clock, from), forecastEndDate: businessDay(clock, late ? to + 21 : to),
        actualStartDate: done || running ? businessDay(clock, from + (index % 3)) : null, actualEndDate: done ? businessDay(clock, to + (index % 4)) : null,
        status, progressPercent: done ? 100 : running ? Math.max(5, Math.min(95, Math.round((-from / (to - from)) * 100))) : 0,
        ownerMemberId: cast.member(index === 0 ? "architect" : "pm"), createdByMemberId: cast.member("pm"), createdAt: at(clock, start - 30),
      },
    });
    phaseIds.push(id);
  }
  const milestoneIds: string[] = [];
  for (const [index, milestone] of MILESTONES.entries()) {
    const planned = day(milestone.at);
    const done = planned < -3;
    const current = !done && planned < 60;
    const status: ProjectMilestoneStatus = done ? "COMPLETED" : current ? (rand.chance(0.35) ? "AT_RISK" : "IN_PROGRESS") : "NOT_STARTED";
    const id = `ms_${projectId}_${index + 1}`;
    await prisma.projectMilestone.create({
      data: {
        id, companyId: cast.companyId, projectId, phaseId: phaseIds[milestone.phase], name: milestone.name, milestoneType: milestone.type, status, ownerMemberId: cast.member("pm"),
        baselineDate: businessDay(clock, planned), plannedDate: businessDay(clock, planned), forecastDate: businessDay(clock, status === "AT_RISK" ? planned + 14 : planned),
        actualDate: done ? businessDay(clock, planned + (index % 5) - 1) : null, progressPercent: done ? 100 : current ? 40 + (index % 4) * 10 : 0,
        critical: milestone.critical ?? false, externallyCommitted: milestone.external ?? false, sortOrder: index + 1, statusChangedAt: at(clock, done ? planned : -10),
        completionNote: done ? "Signed off on site." : null, completedByMemberId: done ? cast.member("pm") : null, createdByMemberId: cast.member("pm"), createdAt: at(clock, start - 30),
      },
    });
    milestoneIds.push(id);
  }
  await prisma.projectMilestoneDependency.createMany({
    data: milestoneIds.slice(1).map((successor, index) => ({ companyId: cast.companyId, projectId, predecessorMilestoneId: milestoneIds[index]!, successorMilestoneId: successor, dependencyType: "FINISH_TO_START" as const, lagDays: 0, createdByMemberId: cast.member("pm") })),
  });
  return { phases: PHASES.length, milestones: MILESTONES.length };
}

/* -------------------------------------------------------------------------- */
/* Daily logs                                                                  */
/* -------------------------------------------------------------------------- */

const DELAYS: Array<{ category: DailyLogDelayCategory; title: string; minutes: number; party: string }> = [
  { category: "WEATHER", title: "Rain stopped the pour", minutes: 180, party: "Weather" },
  { category: "MATERIAL", title: "Rebar delivery arrived late", minutes: 120, party: "Supplier" },
  { category: "INSPECTION", title: "Waiting for the engineer's sign-off before the pour", minutes: 90, party: "Supervising engineer" },
  { category: "EQUIPMENT", title: "Concrete pump broke down", minutes: 150, party: "Plant hire" },
  { category: "ACCESS", title: "Road closed for a municipal event", minutes: 60, party: "Municipality" },
];
const VISITORS = [
  { name: "Bank valuer", organization: "Banka e Bashkuar", purpose: "Progress valuation for the construction loan" },
  { name: "Municipal building inspector", organization: "Bashkia", purpose: "Routine inspection of the permit conditions" },
  { name: "Supervising engineer", organization: "Studio Mbikqyrje", purpose: "Rebar inspection before the pour" },
  { name: "Buyer and family", organization: "Client", purpose: "Viewing of their apartment" },
];
const INSTRUCTIONS = [
  { title: "Add cover spacers on the slab edge", description: "Edge cover measured at 20 mm; raise to 30 mm before the pour." },
  { title: "Keep the north gate clear for deliveries", description: "Trucks waited on the road this morning; marshal the gate from 7:00." },
  { title: "Protect the finished floors", description: "Lay boards on the tiled corridors before the joiners move in." },
];

async function dailyLogs(prisma: PrismaClient, clock: Clock, cast: Cast, site: SiteProfile, rand: Random, contractors: string[]) {
  const existing = new Set((await prisma.dailyLog.findMany({ where: { projectId: site.projectId }, select: { workDate: true } })).map((row) => row.workDate.toISOString().slice(0, 10)));
  const receipts = await prisma.goodsReceipt.findMany({ where: { projectId: site.projectId }, select: { id: true, receiptDate: true, purchaseOrderId: true, supplierId: true, purchaseOrder: { select: { poNumber: true, items: { select: { description: true, quantity: true, unit: true }, take: 2 } } } } });
  const crews = [...new Set([...contractors, "Own crew — formwork", "Own crew — general labour"])];
  let written = 0;
  const workDay = (offset: number) => {
    const date = businessDay(clock, offset);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  };
  let correctionAsked = false;
  for (let offset = 0; offset >= -34; offset -= 1) {
    const date = workDay(offset);
    if (date.getUTCDay() === 0 || existing.has(date.toISOString().slice(0, 10))) continue;
    const rainy = rand.chance(0.22);
    // One log a few days back went back to the engineer for a correction.
    const returned = !correctionAsked && offset <= -4;
    if (returned) correctionAsked = true;
    const status: DailyLogStatus = offset === 0 ? "DRAFT" : offset >= -2 ? "SUBMITTED" : returned ? "CORRECTION_REQUIRED" : offset >= -7 ? "REVIEWED" : "LOCKED";
    const id = `dl_${site.projectId}_${date.toISOString().slice(0, 10).replace(/-/g, "")}`;
    const temperature = Math.round(16 - (offset + 34) * 0.12 + rand.int(-2, 3));
    const condition: DailyLogWeatherCondition = rainy ? (rand.chance(0.3) ? "HEAVY_RAIN" : "RAIN") : rand.pick(["CLEAR", "PARTLY_CLOUDY", "CLOUDY", "WINDY"] as const);
    const siteCondition: DailyLogSiteCondition = rainy ? rand.pick(["WET", "MUDDY"] as const) : condition === "WINDY" ? "HIGH_WIND" : rand.pick(["DRY", "DRY", "DUSTY"] as const);
    const activities = Array.from({ length: rand.int(2, 4) }, () => rand.pick(site.work)).filter((value, index, all) => all.indexOf(value) === index);
    const delay = rainy ? DELAYS[0]! : rand.chance(0.12) ? rand.pick(DELAYS.slice(1)) : null;
    const reviewer = cast.member("pm");
    const submitted = status !== "DRAFT";
    await prisma.dailyLog.create({
      data: {
        id, companyId: cast.companyId, projectId: site.projectId, workDate: date, status, createdByMemberId: cast.member("engineer"),
        submittedByMemberId: submitted ? cast.member("engineer") : null, submittedAt: submitted ? at(clock, offset, 18) : null, submissionCount: submitted ? (status === "CORRECTION_REQUIRED" ? 1 : 1) : 0,
        reviewerMemberId: reviewer, reviewedByMemberId: status === "REVIEWED" || status === "LOCKED" ? reviewer : null, reviewedAt: status === "REVIEWED" || status === "LOCKED" ? at(clock, offset + 1, 9) : null,
        lockedByMemberId: status === "LOCKED" ? reviewer : null, lockedAt: status === "LOCKED" ? at(clock, offset + 3, 9) : null,
        returnedByMemberId: status === "CORRECTION_REQUIRED" ? reviewer : null, returnedAt: status === "CORRECTION_REQUIRED" ? at(clock, offset + 1, 9) : null, returnReason: status === "CORRECTION_REQUIRED" ? "Headcount for the formwork crew is missing; add it and resubmit." : null,
        summary: `${activities[0]}${activities.length > 1 ? `, ${activities.slice(1).map((value) => value.charAt(0).toLowerCase() + value.slice(1)).join(", ")}` : ""}.`,
        weatherSummary: rainy ? "Rain from mid-morning; work moved under cover." : "Fair weather all day.",
        delaySummary: delay ? `${delay.title} (${Math.round(delay.minutes / 60)} h).` : null,
        siteCondition, siteConditionNotes: rainy ? "Standing water by the north gate; pumped out by noon." : null,
        createdAt: at(clock, offset, 7),
        weatherEntries: { create: [{ companyId: cast.companyId, observedAt: at(clock, offset, 8), temperatureC: temperature, condition, precipitationMm: rainy ? rand.int(4, 22) : 0, windKph: condition === "WINDY" ? rand.int(35, 55) : rand.int(5, 20), humidityPct: rainy ? rand.int(80, 95) : rand.int(50, 75) }] },
        workforce: { create: crews.slice(0, rand.int(3, Math.min(5, crews.length))).map((name, index) => ({ companyId: cast.companyId, organizationName: name, trade: index === 0 ? "General contractor" : name.includes("Own crew") ? name.split("— ")[1] : "Subcontractor", headcount: status === "CORRECTION_REQUIRED" && index === 1 ? 0 : rand.int(4, 22) })) },
        workActivities: { create: activities.map((title) => ({ companyId: cast.companyId, title, projectArea: rand.pick(site.areas), progressPercent: rand.int(20, 95), createdByMemberId: cast.member("engineer") })) },
        equipmentEntries: { create: site.plant.slice(0, rand.int(2, site.plant.length)).map((name, index) => ({ companyId: cast.companyId, equipmentName: name, equipmentCode: `EQ-${String(index + 1).padStart(2, "0")}`, quantity: 1, hoursUsed: rainy ? rand.int(2, 5) : rand.int(6, 9), status: delay?.category === "EQUIPMENT" && index === 1 ? "BREAKDOWN" : "IN_USE" })) },
        ...(delay ? { delayEntries: { create: [{ companyId: cast.companyId, category: delay.category, title: delay.title, description: delay.category === "WEATHER" ? "Pour rescheduled to the next dry morning." : null, startedAt: at(clock, offset, 10), endedAt: new Date(at(clock, offset, 10).getTime() + delay.minutes * 60000), durationMinutes: delay.minutes, responsiblePartyText: delay.party, impact: delay.minutes >= 150 ? "MEDIUM" : "LOW" }] } } : {}),
        ...(rand.chance(0.15) ? { visitorEntries: { create: [{ companyId: cast.companyId, ...rand.pick(VISITORS), arrivedAt: at(clock, offset, 10), departedAt: at(clock, offset, 12), escortedByMemberId: cast.member("pm") }] } } : {}),
        ...(rand.chance(0.12) ? { instructionEntries: { create: [{ companyId: cast.companyId, ...rand.pick(INSTRUCTIONS), issuedByMemberId: cast.member("pm"), recipientText: crews[0], issuedAt: at(clock, offset, 11), requiresAction: true }] } } : {}),
      },
    });
    // A delivery the site took that day, tied to its goods receipt.
    const delivered = receipts.filter((row) => row.receiptDate.toISOString().slice(0, 10) === businessDay(clock, offset).toISOString().slice(0, 10));
    if (delivered.length > 0) {
      await prisma.dailyLogDeliveryEntry.createMany({
        data: delivered.map((row) => ({ companyId: cast.companyId, dailyLogId: id, description: row.purchaseOrder.items.map((item) => item.description).join(", "), supplierId: row.supplierId, purchaseOrderId: row.purchaseOrderId, goodsReceiptId: row.id, quantityText: row.purchaseOrder.items[0] ? `Part of ${row.purchaseOrder.poNumber}` : null, deliveredAt: at(clock, offset, 9), conditionNote: "Checked at the gate; delivery note signed." })),
      });
    }
    written += 1;
  }
  await prisma.projectDailyLogSettings.upsert({ where: { projectId: site.projectId }, update: {}, create: { companyId: cast.companyId, projectId: site.projectId, logsRequired: true, reviewerMemberId: cast.member("pm"), workingDays: [1, 2, 3, 4, 5, 6] } });
  return written;
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

type TaskSpec = { title: string; part: Part; status: TaskStatus; priority: TaskPriority; due: number; blocked?: string };

const COMMON_TASKS: TaskSpec[] = [
  { title: "Update the four-week look-ahead programme", part: "pm", status: "IN_PROGRESS", priority: "HIGH", due: 2 },
  { title: "Close out last week's safety walk findings", part: "hse", status: "IN_PROGRESS", priority: "HIGH", due: -1 },
  { title: "Monthly cost report to the CEO", part: "finance", status: "TODO", priority: "MEDIUM", due: 9 },
  { title: "Chase the outstanding installments on the sold units", part: "finance", status: "IN_PROGRESS", priority: "HIGH", due: 3 },
  { title: "Approve the subcontractor's October valuation", part: "pm", status: "COMPLETED", priority: "MEDIUM", due: -6 },
  { title: "Renew the contractors' all-risk insurance certificates", part: "procurement", status: "TODO", priority: "MEDIUM", due: 14 },
  { title: "Price list review with Sales", part: "salesHead", status: "TODO", priority: "MEDIUM", due: 6 },
  { title: "File the monthly progress photos", part: "engineer", status: "COMPLETED", priority: "LOW", due: -3 },
];

const TASKS: Record<string, TaskSpec[]> = {
  project_b: [
    ...COMMON_TASKS,
    { title: "Confirm post-tension stressing sequence for level 10", part: "engineer", status: "IN_PROGRESS", priority: "CRITICAL", due: 1 },
    { title: "Issue façade shop drawings for comment", part: "architect", status: "BLOCKED", priority: "HIGH", due: -2, blocked: "Waiting for the façade contractor's revised anchor details." },
    { title: "Leasing pack for the floor 9–11 suites", part: "sales", status: "IN_PROGRESS", priority: "MEDIUM", due: 5 },
    { title: "Book the podium waterproofing inspection", part: "qaqc", status: "COMPLETED", priority: "HIGH", due: -8 },
  ],
  project_c: [
    ...COMMON_TASKS,
    { title: "Submit the environmental permit amendment", part: "legal", status: "IN_PROGRESS", priority: "CRITICAL", due: 4 },
    { title: "Test pile report to the municipality", part: "engineer", status: "COMPLETED", priority: "HIGH", due: -9 },
    { title: "Phase 2 budget forecast", part: "finance", status: "TODO", priority: "HIGH", due: 7 },
    { title: "Order two more barriers for the north side", part: "hse", status: "COMPLETED", priority: "HIGH", due: -5 },
  ],
  project_d: [
    ...COMMON_TASKS,
    { title: "Updated drawdown schedule for the bank", part: "finance", status: "IN_PROGRESS", priority: "CRITICAL", due: 2 },
    { title: "Lobby interiors, first options", part: "architect", status: "IN_PROGRESS", priority: "MEDIUM", due: 3 },
    { title: "Level 9 pour inspection, Block B", part: "qaqc", status: "TODO", priority: "HIGH", due: 1 },
    { title: "Promenade lighting with the municipality", part: "pm", status: "BLOCKED", priority: "MEDIUM", due: -4, blocked: "The municipality has not yet named its engineer." },
  ],
  project_e: [
    ...COMMON_TASKS,
    { title: "Decide the two open clauses in the hotel management agreement", part: "ceo", status: "IN_PROGRESS", priority: "CRITICAL", due: 1 },
    { title: "Second-release price list for approval", part: "sales", status: "IN_PROGRESS", priority: "HIGH", due: 2 },
    { title: "Traffic plan sign-off for the beach road", part: "hse", status: "COMPLETED", priority: "HIGH", due: -7 },
    { title: "Hotel operator's brand standards review", part: "architect", status: "TODO", priority: "MEDIUM", due: 12 },
  ],
  project_showcase_promenada: [
    ...COMMON_TASKS.slice(0, 5),
    { title: "Snagging walk, Block A floors 1–3", part: "qaqc", status: "IN_PROGRESS", priority: "HIGH", due: 3 },
    { title: "Kitchen supplier's delivery programme", part: "procurement", status: "TODO", priority: "MEDIUM", due: 8 },
    { title: "Shop tenants' fit-out guide", part: "architect", status: "COMPLETED", priority: "LOW", due: -12 },
  ],
  project_showcase_rinas: [
    { title: "Concept design review with the Owner", part: "architect", status: "IN_PROGRESS", priority: "HIGH", due: 6 },
    { title: "Geotechnical survey tender", part: "procurement", status: "TODO", priority: "MEDIUM", due: 15 },
    { title: "Permit application pack", part: "legal", status: "TODO", priority: "HIGH", due: 30 },
    { title: "Feasibility model update", part: "finance", status: "COMPLETED", priority: "MEDIUM", due: -10 },
  ],
  project_showcase_kodra: [
    { title: "Close the last warranty defects before the period ends", part: "pm", status: "IN_PROGRESS", priority: "MEDIUM", due: 20 },
    { title: "Release the façade contractor's retention", part: "finance", status: "TODO", priority: "LOW", due: 25 },
  ],
};

async function addTasks(prisma: PrismaClient, clock: Clock, cast: Cast, projectId: string, specs: TaskSpec[], rand: Random) {
  const rows: Prisma.TaskCreateManyInput[] = specs.map((task, index) => ({
    id: `task_${projectId}_${index + 1}`,
    companyId: cast.companyId,
    projectId,
    title: task.title,
    description: task.blocked ?? null,
    assigneeMemberId: cast.member(task.part),
    status: task.status,
    priority: task.priority,
    startDate: businessDay(clock, task.due - rand.int(5, 15)),
    dueDate: businessDay(clock, task.due),
    completedAt: task.status === "COMPLETED" ? at(clock, task.due - rand.int(0, 2)) : null,
    blockedAt: task.status === "BLOCKED" ? at(clock, task.due - 3) : null,
    blockedByMemberId: task.status === "BLOCKED" ? cast.member(task.part) : null,
    blockedReason: task.blocked ?? null,
    createdByMemberId: cast.member("pm"),
    createdBy: cast.user("pm"),
    createdAt: at(clock, task.due - rand.int(14, 30)),
  }));
  await prisma.task.createMany({ data: rows });
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

async function calendar(prisma: PrismaClient, clock: Clock, cast: Cast) {
  const year = clock.now.getUTCFullYear();
  const holiday = (month: number, dayOfMonth: number, title: string) => {
    const date = new Date(Date.UTC(year, month - 1, dayOfMonth, 0));
    return { title, eventType: "COMPANY_HOLIDAY" as const, startsAt: date, endsAt: new Date(date.getTime() + DAY - 60000), allDay: true };
  };
  const events = [
    holiday(11, 28, "Independence Day"),
    holiday(11, 29, "Liberation Day"),
    holiday(12, 8, "National Youth Day"),
    holiday(12, 25, "Christmas Day"),
    { title: "Group management meeting", eventType: "COMPANY_EVENT" as const, startsAt: at(clock, 4, 9), endsAt: at(clock, 4, 12), allDay: false, location: "Head office, Tirana" },
    { title: "Working at height refresher", eventType: "TRAINING" as const, startsAt: at(clock, 8, 8), endsAt: at(clock, 8, 11), allDay: false, location: "Site welfare unit" },
    { title: "Quarterly accounts to the group", eventType: "INTERNAL_DEADLINE" as const, startsAt: at(clock, 17, 9), endsAt: at(clock, 17, 10), allDay: false },
    { title: "Team dinner", eventType: "TEAM_EVENT" as const, startsAt: at(clock, 36, 19), endsAt: at(clock, 36, 22), allDay: false, location: "Tirana" },
    { title: "First aid course", eventType: "TRAINING" as const, startsAt: at(clock, -12, 9), endsAt: at(clock, -12, 15), allDay: false },
  ];
  await prisma.calendarEvent.createMany({
    data: events.map((event) => ({ companyId: cast.companyId, createdByMemberId: cast.member("hr"), title: event.title, description: null, location: "location" in event ? (event.location ?? null) : null, eventType: event.eventType, startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay, timezone: "Europe/Tirane", visibility: "COMPANY" as const })),
  });
  return events.length;
}
