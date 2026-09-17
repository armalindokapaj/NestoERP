import { Prisma, type PrismaClient } from "@prisma/client";

import { addLocalDays, instantFromLocal, localDate } from "../../lib/modules/calendar/calendar.time";
import { seedStoredDocument } from "./document-objects";
import type { SeedMembers } from "./constants";

/**
 * Daily log demo data (PRD #43 §251).
 *
 * Riverside Residences requires a log for every working day and has three of
 * them: three days back locked as the record, with an official correction;
 * two days back submitted and waiting for the Project Manager; and yesterday
 * still a draft. Between them: workforce by trade, work completed against real
 * tasks, a concrete delivery against its purchase order and goods receipt,
 * equipment, a visitor, a weather delay, an instruction that raised a task,
 * links to a quality inspection and a toolbox talk, and site photos. Today is
 * left for the Engineer to start. Dated relative to the day the seed runs;
 * re-running replaces the seeded logs.
 */
type Members = SeedMembers;

const COMPANY_A = "company_demo_a";
const PROJECT = "project_a";
const ZONE = "Europe/Tirane";

export const DAILY_LOG_SEED = {
  locked: "daily_log_riverside_locked",
  submitted: "daily_log_riverside_submitted",
  draft: "daily_log_riverside_draft",
} as const;

export async function seedDailyLogRecords(prisma: PrismaClient, members: Members) {
  const id = (key: string) => members.get(key)!;
  const engineer = id("user_engineer");
  const pm = id("user_pm");
  const today = localDate(new Date(), ZONE);
  const at = (date: string, time: string) => instantFromLocal(date, time, ZONE);
  const day = (offset: number) => addLocalDays(today, offset);
  const midday = (date: string) => new Date(`${date}T12:00:00.000Z`);

  await prisma.dailyLogSettings.upsert({ where: { companyId: COMPANY_A }, update: {}, create: { companyId: COMPANY_A } });
  await prisma.projectDailyLogSettings.upsert({
    where: { projectId: PROJECT },
    update: { logsRequired: true, reviewerMemberId: pm, workingDays: [1, 2, 3, 4, 5] },
    create: { companyId: COMPANY_A, projectId: PROJECT, logsRequired: true, reviewerMemberId: pm, workingDays: [1, 2, 3, 4, 5], updatedByMemberId: pm },
  });

  // Whatever sits on these days now — a previous seed, a test — makes way.
  const dates = [day(-3), day(-2), day(-1)];
  const existing = await prisma.dailyLog.findMany({ where: { OR: [{ id: { in: Object.values(DAILY_LOG_SEED) } }, { companyId: COMPANY_A, projectId: PROJECT, workDate: { in: dates.map(midday) } }] }, select: { id: true } });
  const existingIds = existing.map((row) => row.id);
  if (existingIds.length) {
    await prisma.integrationLink.deleteMany({ where: { integrationType: "DAILY_LOG_RECORD", sourceEntityId: { in: existingIds } } });
    await prisma.document.updateMany({ where: { entityType: "daily_log", entityId: { in: existingIds }, id: { startsWith: "document_daily_log_" } }, data: { entityId: null, entityType: null } });
    await prisma.dailyLog.deleteMany({ where: { id: { in: existingIds } } });
  }

  const common = { companyId: COMPANY_A, projectId: PROJECT, createdByMemberId: engineer };

  /* Three days back: locked, corrected --------------------------------------- */
  const lockedDate = day(-3);
  await prisma.dailyLog.create({
    data: {
      ...common,
      id: DAILY_LOG_SEED.locked,
      workDate: midday(lockedDate),
      status: "LOCKED",
      submittedByMemberId: engineer,
      submittedAt: at(lockedDate, "17:40"),
      reviewerMemberId: pm,
      reviewedByMemberId: pm,
      reviewedAt: at(day(-2), "08:15"),
      lockedByMemberId: pm,
      lockedAt: at(day(-2), "08:20"),
      submissionCount: 1,
      version: 12,
      summary: "Level 3 slab pour on Block B completed. Façade scaffold extended to level 4. Rain stopped external work for 90 minutes after lunch.",
      weatherSummary: "Cloudy morning, rain 13:00–14:30, clearing later.",
      siteCondition: "WET",
      siteConditionNotes: "Standing water by the east gate after the rain.",
      delaySummary: "90 minutes of external work lost to rain.",
      weatherEntries: {
        create: [
          { companyId: COMPANY_A, observedAt: at(lockedDate, "07:00"), temperatureC: new Prisma.Decimal(17), condition: "CLOUDY", windKph: new Prisma.Decimal(12), humidityPct: 70 },
          { companyId: COMPANY_A, observedAt: at(lockedDate, "13:00"), temperatureC: new Prisma.Decimal(15), condition: "RAIN", precipitationMm: new Prisma.Decimal(6.5), windKph: new Prisma.Decimal(24), humidityPct: 92 },
        ],
      },
      workforce: {
        create: [
          { companyId: COMPANY_A, organizationName: "Alba Concrete", supplierId: "supplier_alba", trade: "Concrete", crewName: "Pour crew B", headcount: 14 },
          { companyId: COMPANY_A, organizationName: "Riverside Scaffolding", trade: "Scaffolding", headcount: 6 },
          { companyId: COMPANY_A, organizationName: "NESTO site team", trade: "Supervision", headcount: 4 },
        ],
      },
      workActivities: {
        create: [
          { companyId: COMPANY_A, title: "Level 3 slab pour, Block B", description: "212 m³ placed; cubes taken at 50 m³ intervals.", projectArea: "Block B", floorZone: "Level 3", trade: "Concrete", progressPercent: new Prisma.Decimal(100), linkedTaskId: "task_007", createdByMemberId: engineer },
          { companyId: COMPANY_A, title: "Façade scaffold to level 4", projectArea: "East façade", floorZone: "Levels 3–4", trade: "Scaffolding", progressPercent: new Prisma.Decimal(60), createdByMemberId: engineer },
        ],
      },
      equipmentEntries: {
        create: [
          { companyId: COMPANY_A, equipmentName: "Concrete pump 42 m", equipmentCode: "PMP-42", supplierId: "supplier_alba", quantity: 1, hoursUsed: new Prisma.Decimal(7.5), status: "IN_USE" },
          { companyId: COMPANY_A, equipmentName: "Tower crane TC-1", quantity: 1, hoursUsed: new Prisma.Decimal(6), status: "IN_USE", notes: "Stood down during the rain for wind." },
        ],
      },
      deliveryEntries: {
        create: [{ companyId: COMPANY_A, description: "Ready-mix C30/37, 26 truckloads", supplierId: "supplier_alba", purchaseOrderId: "order_002", goodsReceiptId: "receipt_003", quantityText: "212 m³", deliveredAt: at(lockedDate, "06:45"), conditionNote: "Slump tested on arrival, all within tolerance." }],
      },
      visitorEntries: {
        create: [{ companyId: COMPANY_A, name: "Client representative", organization: "Acme Development", purpose: "Witnessed the slab pour", arrivedAt: at(lockedDate, "09:30"), departedAt: at(lockedDate, "11:00"), escortedByMemberId: pm }],
      },
      delayEntries: {
        create: [{ companyId: COMPANY_A, category: "WEATHER", title: "Rain stopped external works", startedAt: at(lockedDate, "13:00"), endedAt: at(lockedDate, "14:30"), durationMinutes: 90, impact: "MEDIUM", responsiblePartyText: "Weather" }],
      },
      corrections: {
        create: [{ companyId: COMPANY_A, reason: "Pour volume was mistyped.", correctionSummary: "The slab pour placed 214 m³, not 212 m³, per the supplier's delivery tickets.", createdByMemberId: pm, approvedByMemberId: pm, approvedAt: at(day(-1), "09:00") }],
      },
    },
  });

  /* Two days back: submitted, waiting for review ------------------------------ */
  const submittedDate = day(-2);
  await prisma.dailyLog.create({
    data: {
      ...common,
      id: DAILY_LOG_SEED.submitted,
      workDate: midday(submittedDate),
      status: "SUBMITTED",
      submittedByMemberId: engineer,
      submittedAt: at(submittedDate, "17:55"),
      reviewerMemberId: pm,
      submissionCount: 1,
      version: 9,
      summary: "Formwork for level 4 columns started; MEP sleeves set out on level 3. The architect instructed a change to the balcony balustrade fixings.",
      weatherSummary: "Clear and dry.",
      siteCondition: "DRY",
      instructionSummary: "Balustrade fixing detail changed on site by the architect.",
      weatherEntries: { create: [{ companyId: COMPANY_A, observedAt: at(submittedDate, "07:00"), temperatureC: new Prisma.Decimal(21), condition: "CLEAR", windKph: new Prisma.Decimal(8), humidityPct: 55 }] },
      workforce: {
        create: [
          { companyId: COMPANY_A, organizationName: "Riverside Formwork", trade: "Formwork", crewName: "Crew 2", headcount: 9 },
          { companyId: COMPANY_A, organizationName: "Delta MEP", trade: "Mechanical & electrical", headcount: 5 },
          { companyId: COMPANY_A, organizationName: "NESTO site team", trade: "Supervision", headcount: 4 },
        ],
      },
      workActivities: {
        create: [
          { companyId: COMPANY_A, title: "Level 4 column formwork", projectArea: "Block B", floorZone: "Level 4", trade: "Formwork", progressPercent: new Prisma.Decimal(35), createdByMemberId: engineer },
          { companyId: COMPANY_A, title: "MEP sleeve set-out", projectArea: "Block B", floorZone: "Level 3", trade: "Mechanical & electrical", progressPercent: new Prisma.Decimal(80), linkedTaskId: "task_006", createdByMemberId: engineer },
        ],
      },
      deliveryEntries: {
        create: [{ companyId: COMPANY_A, description: "Rebar bundles, 12 mm and 16 mm", supplierId: "supplier_nordsteel", purchaseOrderId: "order_001", quantityText: "8.4 t", deliveredAt: at(submittedDate, "08:10"), conditionNote: "Two bundles with surface rust set aside." }],
      },
      instructionEntries: {
        create: [{ companyId: COMPANY_A, title: "Balustrade fixings changed", description: "Use the revised through-bolt detail on all Block B balconies from level 4.", issuedByText: "Lead Architect", issuedByMemberId: id("user_architect"), recipientText: "Site team", issuedAt: at(submittedDate, "10:20"), requiresAction: true, linkedTaskId: "task_006" }],
      },
      taskLinks: {
        create: [
          { companyId: COMPANY_A, taskId: "task_006", linkType: "INSTRUCTION_ACTION", createdByMemberId: engineer },
          { companyId: COMPANY_A, taskId: "task_007", linkType: "FOLLOW_UP", createdByMemberId: engineer },
        ],
      },
    },
  });

  /* Yesterday: still a draft ---------------------------------------------------- */
  const draftDate = day(-1);
  await prisma.dailyLog.create({
    data: {
      ...common,
      id: DAILY_LOG_SEED.draft,
      workDate: midday(draftDate),
      status: "DRAFT",
      version: 3,
      summary: "Column formwork continued.",
      workforce: { create: [{ companyId: COMPANY_A, organizationName: "Riverside Formwork", trade: "Formwork", headcount: 8 }] },
    },
  });

  // The trail each seeded log's history is read from (§195).
  const history = [
    { log: DAILY_LOG_SEED.locked, action: "DAILY_LOG_CREATED", actor: engineer, at: at(lockedDate, "07:05"), message: "started the daily log" },
    { log: DAILY_LOG_SEED.locked, action: "DAILY_LOG_SUBMITTED", actor: engineer, at: at(lockedDate, "17:40"), message: "submitted the daily log" },
    { log: DAILY_LOG_SEED.locked, action: "DAILY_LOG_REVIEWED", actor: pm, at: at(day(-2), "08:15"), message: "reviewed the daily log" },
    { log: DAILY_LOG_SEED.locked, action: "DAILY_LOG_LOCKED", actor: pm, at: at(day(-2), "08:20"), message: "locked the daily log as the official record" },
    { log: DAILY_LOG_SEED.locked, action: "DAILY_LOG_CORRECTION_ADDED", actor: pm, at: at(day(-1), "09:00"), message: "added an official correction", note: "Pour volume was mistyped." },
    { log: DAILY_LOG_SEED.submitted, action: "DAILY_LOG_CREATED", actor: engineer, at: at(submittedDate, "07:10"), message: "started the daily log" },
    { log: DAILY_LOG_SEED.submitted, action: "DAILY_LOG_SUBMITTED", actor: engineer, at: at(submittedDate, "17:55"), message: "submitted the daily log" },
    { log: DAILY_LOG_SEED.draft, action: "DAILY_LOG_CREATED", actor: engineer, at: at(day(-1), "07:20"), message: "started the daily log" },
  ];
  await prisma.activity.deleteMany({ where: { entityType: "DailyLog", entityId: { in: Object.values(DAILY_LOG_SEED) } } });
  await prisma.activity.createMany({
    data: history.map((entry) => ({ companyId: COMPANY_A, module: "dailyLogs", entityType: "DailyLog", entityId: entry.log, action: entry.action, message: entry.message, actorMemberId: entry.actor, createdAt: entry.at, ...(entry.note ? { metadata: { note: entry.note } } : {}) })),
  });

  // Quality and safety records referenced, never changed (§63, §66).
  const links = [
    { log: DAILY_LOG_SEED.locked, module: "qaqc", type: "quality_inspection", target: "ins_007" },
    { log: DAILY_LOG_SEED.locked, module: "hse", type: "toolbox_talk", target: "hse_tbt_011" },
    { log: DAILY_LOG_SEED.submitted, module: "hse", type: "hazard", target: "hse_hz_001" },
  ];
  for (const link of links) {
    // The same key `linkReference` writes: source type, source, target type,
    // target (PRD #48 §65).
    const key = `daily_log:${link.log}:${link.type}:${link.target}`;
    await prisma.integrationLink.upsert({
      where: { companyId_integrationType_idempotencyKey: { companyId: COMPANY_A, integrationType: "DAILY_LOG_RECORD", idempotencyKey: key } },
      update: { status: "ACTIVE", sourceEntityId: link.log },
      create: { companyId: COMPANY_A, integrationType: "DAILY_LOG_RECORD", mode: "REFERENCE", sourceModule: "dailyLogs", sourceEntityType: "daily_log", sourceEntityId: link.log, targetModule: link.module, targetEntityType: link.type, targetEntityId: link.target, idempotencyKey: key, createdByMemberId: engineer },
    });
  }

  // Site photos and a delivery ticket, as real stored documents on the log (§74-§79).
  const files = [
    { id: "document_daily_log_pour_1", log: DAILY_LOG_SEED.locked, name: "Block B level 3 pour.jpg", category: "PHOTO" as const, caption: "Pour under way from the north side", time: "10:05", order: 1 },
    { id: "document_daily_log_pour_2", log: DAILY_LOG_SEED.locked, name: "Slab finished.jpg", category: "PHOTO" as const, caption: "Finished slab before curing compound", time: "16:30", order: 2 },
    { id: "document_daily_log_ticket", log: DAILY_LOG_SEED.locked, name: "Ready-mix delivery tickets.pdf", category: "DELIVERY_TICKET" as const, caption: "Alba Concrete tickets 1–26", time: null, order: 3 },
    { id: "document_daily_log_formwork", log: DAILY_LOG_SEED.submitted, name: "Level 4 formwork.jpg", category: "PHOTO" as const, caption: "Column formwork, gridline C", time: "15:10", order: 1 },
  ];
  for (const file of files) {
    await seedStoredDocument(prisma, { id: file.id, companyId: COMPANY_A, name: file.name, projectId: PROJECT, module: "dailyLogs", entityType: "daily_log", entityId: file.log, uploadedByMemberId: engineer, createdBy: "user_engineer" });
    const logDate = file.log === DAILY_LOG_SEED.locked ? lockedDate : submittedDate;
    await prisma.dailyLogDocumentLink.upsert({
      where: { dailyLogId_documentId: { dailyLogId: file.log, documentId: file.id } },
      update: { category: file.category, caption: file.caption, sortOrder: file.order },
      create: { companyId: COMPANY_A, dailyLogId: file.log, documentId: file.id, category: file.category, caption: file.caption, takenAt: file.time ? at(logDate, file.time) : null, sortOrder: file.order },
    });
  }

  return { logs: 3, photos: files.filter((file) => file.category === "PHOTO").length, links: links.length };
}
