import { Prisma, type PrismaClient } from "@prisma/client";

import { addLocalDays, localDate } from "../../lib/modules/calendar/calendar.time";

/**
 * Project planning demo data (PRD #44 §311).
 *
 * Riverside Residences gets a plan in six phases — Pre-Construction,
 * Structure, Envelope, MEP, Commissioning, Handover — with milestones either
 * side of today: three achieved, Structure Complete forecast ten days past its
 * baseline, Roof Watertight at risk behind a critical blocker, a scaffold
 * inspection five days overdue, and the handover dates committed to the
 * client. Dependencies run through the plan; tasks, a coordination meeting
 * and a locked daily log hang off Structure Complete. Company B has one
 * milestone, for isolation. Dated relative to the day the seed runs;
 * re-running replaces the seeded plan.
 */
type Members = Map<string, string>;

const COMPANY_A = "company_demo_a";
const COMPANY_B = "company_demo_b";
const RIVERSIDE = "project_a";
const ZONE = "Europe/Tirane";

export const PLANNING_SEED = {
  phases: {
    preConstruction: "phase_riverside_pre",
    structure: "phase_riverside_structure",
    envelope: "phase_riverside_envelope",
    mep: "phase_riverside_mep",
    commissioning: "phase_riverside_commissioning",
    handover: "phase_riverside_handover",
  },
  milestones: {
    mobilization: "milestone_riverside_mobilization",
    designFreeze: "milestone_riverside_design_freeze",
    foundation: "milestone_riverside_foundation",
    structure: "milestone_riverside_structure",
    scaffold: "milestone_riverside_scaffold",
    roof: "milestone_riverside_roof",
    facade: "milestone_riverside_facade",
    firstFix: "milestone_riverside_first_fix",
    commissioning: "milestone_riverside_commissioning",
    practical: "milestone_riverside_practical",
    handover: "milestone_riverside_handover",
    companyB: "milestone_b_tender_award",
  },
  blocker: "blocker_riverside_roof_membrane",
} as const;

export async function seedPlanningRecords(prisma: PrismaClient, members: Members) {
  const id = (key: string) => members.get(key)!;
  const pm = id("user_pm");
  const engineer = id("user_engineer");
  const architect = id("user_architect");
  const qaqc = id("user_qaqc");
  const ownerB = id("user_owner_b");
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const P = PLANNING_SEED.phases;
  const M = PLANNING_SEED.milestones;

  // Whatever a previous seed or a test left on these plans makes way.
  const milestoneIds = (await prisma.projectMilestone.findMany({ where: { OR: [{ projectId: RIVERSIDE }, { id: { in: Object.values(M) } }] }, select: { id: true } })).map((row) => row.id);
  await prisma.integrationLink.deleteMany({ where: { integrationType: "MILESTONE_RECORD", sourceEntityId: { in: milestoneIds } } });
  await prisma.projectMilestoneBlocker.deleteMany({ where: { milestoneId: { in: milestoneIds } } });
  await prisma.projectMilestoneTaskLink.deleteMany({ where: { milestoneId: { in: milestoneIds } } });
  await prisma.projectMilestoneDependency.deleteMany({ where: { OR: [{ predecessorMilestoneId: { in: milestoneIds } }, { successorMilestoneId: { in: milestoneIds } }] } });
  await prisma.activity.deleteMany({ where: { entityType: "ProjectMilestone", entityId: { in: milestoneIds } } });
  await prisma.attentionItem.deleteMany({ where: { entityType: "project_milestone", entityId: { in: milestoneIds } } });
  await prisma.projectMilestone.deleteMany({ where: { id: { in: milestoneIds } } });
  await prisma.projectPhase.deleteMany({ where: { OR: [{ projectId: RIVERSIDE }, { id: { in: [...Object.values(P), "phase_b_tender"] } }] } });

  await prisma.projectPlanningSettings.upsert({ where: { companyId: COMPANY_A }, update: {}, create: { companyId: COMPANY_A } });
  await prisma.project.update({ where: { id: RIVERSIDE }, data: { planningBaselineLocked: false, planningTemplateKey: "residential" } });

  const phase = (key: string, name: string, sortOrder: number, data: Partial<Prisma.ProjectPhaseUncheckedCreateInput>) =>
    prisma.projectPhase.create({ data: { id: key, companyId: COMPANY_A, projectId: RIVERSIDE, name, sortOrder, createdByMemberId: pm, ...data } });
  await phase(P.preConstruction, "Pre-Construction", 1, { status: "COMPLETED", progressPercent: new Prisma.Decimal(100), plannedStartDate: day(-125), plannedEndDate: day(-75), actualStartDate: day(-124), actualEndDate: day(-76), ownerMemberId: pm });
  await phase(P.structure, "Structure", 2, { status: "IN_PROGRESS", progressPercent: new Prisma.Decimal(60), plannedStartDate: day(-70), plannedEndDate: day(30), forecastEndDate: day(40), actualStartDate: day(-68), ownerMemberId: engineer });
  await phase(P.envelope, "Envelope", 3, { status: "AT_RISK", plannedStartDate: day(10), plannedEndDate: day(90), forecastEndDate: day(95), ownerMemberId: architect });
  await phase(P.mep, "MEP", 4, { plannedStartDate: day(60), plannedEndDate: day(125) });
  await phase(P.commissioning, "Commissioning", 5, { plannedStartDate: day(160), plannedEndDate: day(205) });
  await phase(P.handover, "Handover", 6, { plannedStartDate: day(205), plannedEndDate: day(240), ownerMemberId: pm });

  type Seeded = Partial<Prisma.ProjectMilestoneUncheckedCreateInput> & { id: string; name: string; phaseId: string; milestoneType: Prisma.ProjectMilestoneUncheckedCreateInput["milestoneType"]; sortOrder: number };
  const milestone = (data: Seeded) => prisma.projectMilestone.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, createdByMemberId: pm, statusChangedAt: day(-3), ...data } });
  const completed = (baseline: number, actual: number) => ({ status: "COMPLETED" as const, baselineDate: day(baseline), plannedDate: day(baseline), forecastDate: day(baseline), actualDate: day(actual), progressPercent: new Prisma.Decimal(100), completedByMemberId: pm });

  await milestone({ id: M.mobilization, name: "Site Mobilization", phaseId: P.preConstruction, milestoneType: "PROJECT_START", sortOrder: 1, ownerMemberId: pm, externallyCommitted: true, ...completed(-120, -122) });
  await milestone({ id: M.designFreeze, name: "Design Freeze", phaseId: P.preConstruction, milestoneType: "DESIGN", sortOrder: 2, ownerMemberId: architect, critical: true, ...completed(-80, -76), completionNote: "Final layouts signed off by the client." });
  await milestone({ id: M.foundation, name: "Foundation Complete", phaseId: P.structure, milestoneType: "CONSTRUCTION", sortOrder: 1, ownerMemberId: engineer, ...completed(-40, -35) });
  await milestone({
    id: M.structure, name: "Structure Complete", phaseId: P.structure, milestoneType: "CONSTRUCTION", sortOrder: 2, ownerMemberId: pm, critical: true,
    status: "IN_PROGRESS", baselineDate: day(30), plannedDate: day(30), forecastDate: day(40), progressPercent: new Prisma.Decimal(65),
    description: "Frame and slabs complete to roof level on Blocks A and B.",
  });
  await milestone({ id: M.scaffold, name: "Scaffold Inspection Passed", phaseId: P.structure, milestoneType: "INSPECTION", sortOrder: 3, ownerMemberId: qaqc, status: "IN_PROGRESS", baselineDate: day(-10), plannedDate: day(-10), forecastDate: day(-5), progressPercent: new Prisma.Decimal(80) });
  await milestone({ id: M.roof, name: "Roof Watertight", phaseId: P.envelope, milestoneType: "CONSTRUCTION", sortOrder: 1, ownerMemberId: engineer, critical: true, status: "AT_RISK", baselineDate: day(55), plannedDate: day(55), forecastDate: day(62), statusChangedAt: day(-2) });
  await milestone({ id: M.facade, name: "Façade Complete", phaseId: P.envelope, milestoneType: "CONSTRUCTION", sortOrder: 2, ownerMemberId: architect, externallyCommitted: true, baselineDate: day(90), plannedDate: day(90), forecastDate: day(95) });
  await milestone({ id: M.firstFix, name: "MEP First Fix Complete", phaseId: P.mep, milestoneType: "CONSTRUCTION", sortOrder: 1, ownerMemberId: engineer, baselineDate: day(120), plannedDate: day(120), forecastDate: day(120) });
  await milestone({ id: M.commissioning, name: "Testing & Commissioning Complete", phaseId: P.commissioning, milestoneType: "COMMISSIONING", sortOrder: 1, baselineDate: day(200), plannedDate: day(200), forecastDate: day(205) });
  await milestone({ id: M.practical, name: "Practical Completion", phaseId: P.handover, milestoneType: "HANDOVER", sortOrder: 1, ownerMemberId: pm, critical: true, externallyCommitted: true, baselineDate: day(215), plannedDate: day(215), forecastDate: day(225) });
  await milestone({ id: M.handover, name: "Handover", phaseId: P.handover, milestoneType: "HANDOVER", sortOrder: 2, ownerMemberId: pm, externallyCommitted: true, baselineDate: day(235), plannedDate: day(235), forecastDate: day(240) });

  const edges: Array<[string, string, number]> = [
    [M.mobilization, M.designFreeze, 0],
    [M.designFreeze, M.foundation, 0],
    [M.foundation, M.structure, 0],
    [M.structure, M.roof, 0],
    [M.structure, M.facade, 7],
    [M.roof, M.firstFix, 0],
    [M.firstFix, M.commissioning, 0],
    [M.commissioning, M.practical, 0],
    [M.facade, M.practical, 0],
    [M.practical, M.handover, 14],
  ];
  await prisma.projectMilestoneDependency.createMany({ data: edges.map(([predecessorMilestoneId, successorMilestoneId, lagDays]) => ({ companyId: COMPANY_A, projectId: RIVERSIDE, predecessorMilestoneId, successorMilestoneId, lagDays, createdByMemberId: pm })) });

  const tasks = await prisma.task.findMany({ where: { id: { in: ["task_001", "task_006", "task_008", "task_009"] }, projectId: RIVERSIDE }, select: { id: true } });
  const linkType: Record<string, "SUPPORTS" | "DELIVERS" | "BLOCKS" | "RELATED"> = { task_001: "SUPPORTS", task_006: "DELIVERS", task_008: "DELIVERS", task_009: "RELATED" };
  const taskMilestone: Record<string, string> = { task_001: M.structure, task_006: M.structure, task_008: M.foundation, task_009: M.scaffold };
  await prisma.projectMilestoneTaskLink.createMany({ data: tasks.map((task) => ({ companyId: COMPANY_A, milestoneId: taskMilestone[task.id], taskId: task.id, linkType: linkType[task.id], createdByMemberId: pm })) });

  await prisma.projectMilestoneBlocker.createMany({
    data: [
      { id: PLANNING_SEED.blocker, companyId: COMPANY_A, milestoneId: M.roof, title: "Roofing membrane delivery slipped two weeks", description: "Supplier moved the membrane delivery; installation cannot start before it arrives.", severity: "CRITICAL", ownerMemberId: engineer, dueDate: day(7), createdByMemberId: pm },
      { companyId: COMPANY_A, milestoneId: M.scaffold, title: "Missing tie inspection certificates on Block B", severity: "MEDIUM", ownerMemberId: qaqc, dueDate: day(2), createdByMemberId: engineer },
      { companyId: COMPANY_A, milestoneId: M.foundation, title: "Pile test results outstanding", severity: "HIGH", ownerMemberId: engineer, resolvedAt: day(-38), resolvedByMemberId: engineer, resolutionNote: "Results received and accepted.", createdByMemberId: pm },
    ],
  });

  // A coordination meeting and a locked site day behind Structure Complete (§60, §63).
  const [meeting, log] = await Promise.all([
    prisma.meeting.findFirst({ where: { companyId: COMPANY_A, projectId: RIVERSIDE }, orderBy: { startsAt: "asc" }, select: { id: true } }),
    prisma.dailyLog.findFirst({ where: { companyId: COMPANY_A, projectId: RIVERSIDE, status: "LOCKED" }, select: { id: true } }),
  ]);
  const links = [meeting && { type: "meeting", module: "meetings", id: meeting.id }, log && { type: "daily_log", module: "dailyLogs", id: log.id }].filter((value): value is { type: string; module: string; id: string } => Boolean(value));
  for (const link of links) {
    await prisma.integrationLink.create({
      data: {
        companyId: COMPANY_A, integrationType: "MILESTONE_RECORD", mode: "REFERENCE",
        sourceModule: "projects", sourceEntityType: "project_milestone", sourceEntityId: M.structure,
        targetModule: link.module, targetEntityType: link.type, targetEntityId: link.id,
        // The same key `linkReference` writes (PRD #48 §65).
        idempotencyKey: `project_milestone:${M.structure}:${link.type}:${link.id}`, createdByMemberId: pm,
      },
    });
  }

  const pmUser = await prisma.companyMember.findUniqueOrThrow({ where: { id: pm }, select: { userId: true } });
  const history = (entityId: string, action: string, message: string, at: Date, note?: string) => ({ companyId: COMPANY_A, module: "projects", entityType: "ProjectMilestone", entityId, action, message, actorMemberId: pm, actorUserId: pmUser.userId, createdAt: at, metadata: note ? { note } : undefined });
  await prisma.activity.createMany({
    data: [
      history(M.designFreeze, "MILESTONE_COMPLETED", "completed Design Freeze", day(-76), "Final layouts signed off by the client."),
      history(M.foundation, "MILESTONE_COMPLETED", "completed Foundation Complete", day(-35)),
      history(M.structure, "MILESTONE_FORECAST_CHANGED", "moved the forecast of Structure Complete", day(-6), "Rebar deliveries for level 5 arrived ten days late."),
      history(M.roof, "MILESTONE_CRITICAL_BLOCKER", "added a critical blocker to Roof Watertight", day(-2), "Roofing membrane delivery slipped two weeks"),
      history(M.roof, "MILESTONE_AT_RISK", "marked Roof Watertight at risk", day(-2)),
    ],
  });

  // Company B: one milestone, for isolation (§295).
  await prisma.projectPhase.create({ data: { id: "phase_b_tender", companyId: COMPANY_B, projectId: "project_b_one", name: "Tender", sortOrder: 1, createdByMemberId: ownerB } });
  await prisma.projectMilestone.create({ data: { id: M.companyB, companyId: COMPANY_B, projectId: "project_b_one", phaseId: "phase_b_tender", name: "Tender Award", milestoneType: "CONTRACTUAL", sortOrder: 1, baselineDate: day(20), plannedDate: day(20), forecastDate: day(20), ownerMemberId: ownerB, createdByMemberId: ownerB } });

  return { phases: 7, milestones: 12, dependencies: edges.length, blockers: 3 };
}
