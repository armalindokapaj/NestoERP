/**
 * Tirana Lake's site diary (D-02 §36, §63, §68, §77).
 *
 * Twenty-four daily logs, one for every working day (Monday to Saturday) of
 * the last four weeks: the older ones reviewed and locked by the project
 * manager, two reviewed, one sent back for a correction, two waiting for
 * review, and yesterday's still a draft. Each is what the product keeps:
 *
 *   weather       morning and afternoon, with the two wet days and a windy one
 *   workforce     E-04's crews by name (headcounts from the site sheet where it
 *                 was kept) and the subcontractors with their work packages
 *   work          the slab cycle up Tower A, the curtain wall on Tower B, MEP
 *                 first fix, basement waterproofing
 *   equipment     the two tower cranes, the pump on pour days, the hoist
 *   deliveries    against the purchase orders and goods receipts they came on
 *                 (the rebar also against its inventory receipt)
 *   visitors, delays, instructions, the tasks they raised, photos, and one
 *   official correction on a locked log; the toolbox talk, the cube test and
 *   a hazard referenced, never changed
 *
 * Written once, on the first run — the days are relative to it, like E-04's
 * attendance. Every value is synthetic. Stable ids; a rerun adds nothing.
 */
import { Prisma, type DailyLogStatus, type DailyLogWeatherCondition, type PrismaClient } from "@prisma/client";

import { addLocalDays, instantFromLocal, localDate } from "../../../lib/modules/calendar/calendar.time";
import { seedStoredDocument } from "../document-objects";
import { memberId } from "./access";
import { contractorId, supplierId } from "./operations";
import { companyId } from "./organization";
import { userId } from "./people";
import { projectId } from "./projects";
import { QUALITY } from "./quality";
import { ARMAAR_GROUP_ID } from "./records";
import { SAFETY } from "./safety";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const TL = projectId("TIRANA_LAKE");
const DAYS = 24;
const dec = (value: number) => new Prisma.Decimal(value);

const CREWS = [
  { id: "armaar_crew_tl_concrete", name: "Tower A concrete crew", trade: "Concrete" },
  { id: "armaar_crew_tl_formwork", name: "Tower B formwork crew", trade: "Formwork" },
  { id: "armaar_crew_tl_steel", name: "Steel fixers", trade: "Steel fixing" },
  { id: "armaar_crew_tl_yard", name: "Yard and lifting", trade: "Crane & lifting" },
];

/** Subcontractors on site: from which log (0 = oldest) they are there, and how many. */
const CONTRACTORS = [
  { key: "albabuild", name: "AlbaBuild", trade: "Concrete frame", from: 0, base: 12 },
  { key: "elektronord", name: "ElektroNord", trade: "Electrical", from: 0, base: 5 },
  { key: "aquatek", name: "AquaTek Instalime", trade: "Plumbing", from: 2, base: 4 },
  { key: "vlora_glass", name: "Vlora Glass Systems", trade: "Façade", from: 6, base: 6 },
  { key: "klimatek", name: "KlimaTek", trade: "HVAC", from: 10, base: 3 },
];

/** What arrived on the day, by days before the seed (D-01's and D-02's goods receipts). */
const DELIVERIES: Record<number, { description: string; supplier: string; order: string; receipt: string; inventory?: string; quantity: string; condition: string }> = {
  [-25]: { description: "Ready-mix C35/45, podium slab — first part", supplier: "tirana_readymix", order: "armaar_po_tl_002", receipt: "armaar_grn_tl_002", quantity: "1,056 m³", condition: "Slump tested on arrival; all within tolerance." },
  [-20]: { description: "Rebar B500C, 12–32 mm, Tower A levels 9 to 12", supplier: "adriatik_steel", order: "armaar_po_tl_001", receipt: "armaar_grn_tl_001", inventory: "armaar_ir_bci_0002", quantity: "243 t", condition: "Mill certificates checked against SUB-006." },
  [-12]: { description: "Ready-mix C35/45, podium slab — final part", supplier: "tirana_readymix", order: "armaar_po_tl_002", receipt: "armaar_grn_tl_003", quantity: "704 m³", condition: "Two trucks turned away for slump; replaced within the hour." },
  [-8]: { description: "Show apartment furniture", supplier: "mobilia", order: "armaar_po_tl_furniture", receipt: "armaar_grn_tl_furniture_0070", quantity: "1 lot", condition: "Two chairs scratched; supplier replacing them." },
  [-6]: { description: "Air handling units AHU-1 to AHU-3", supplier: "klimatek", order: "armaar_po_tl_ahu", receipt: "armaar_grn_tl_ahu_0071", quantity: "3 units", condition: "Inspected on delivery (INS-2026-0118); no damage." },
};

const VISITORS = [
  { name: "Lender's monitoring surveyor", organization: "Demo Bank sh.a.", purpose: "Monthly progress visit" },
  { name: "Building inspector", organization: "Tirana Municipality", purpose: "Structural frame inspection, Tower A" },
  { name: "Buyers' tour", organization: "BUILDING CONSTRUCTION INVEST — sales", purpose: "Show apartment preview for reserved buyers" },
  { name: "Insurer's risk engineer", organization: "Demo Insurance Co.", purpose: "Contractor's all-risk survey" },
];

export async function seedArmaarSite(prisma: PrismaClient) {
  const company = companyId(BCI);
  const engineer = memberId("arlis.site-engineer", BCI);
  const pm = memberId("bci.pm", BCI);
  await prisma.dailyLogSettings.upsert({ where: { companyId: company }, update: {}, create: { companyId: company } });
  await prisma.projectDailyLogSettings.upsert({
    where: { projectId: TL },
    update: {},
    create: { companyId: company, projectId: TL, logsRequired: true, reviewerMemberId: pm, workingDays: [1, 2, 3, 4, 5, 6], updatedByMemberId: pm },
  });

  if ((await prisma.dailyLog.count({ where: { id: { startsWith: "armaar_dl_tl_" } } })) > 0) return { logs: await prisma.dailyLog.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }) };

  const today = localDate(new Date(), ZONE);
  // The last twenty-four working days before today, oldest first.
  const offsets: number[] = [];
  for (let offset = -1; offsets.length < DAYS; offset -= 1) {
    if (new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`).getUTCDay() !== 0) offsets.unshift(offset);
  }
  const statusOf = (index: number): DailyLogStatus => {
    const fromEnd = DAYS - 1 - index;
    return fromEnd === 0 ? "DRAFT" : fromEnd <= 2 ? "SUBMITTED" : fromEnd === 3 ? "CORRECTION_REQUIRED" : fromEnd <= 5 ? "REVIEWED" : "LOCKED";
  };

  // Who the site sheet marked present, crew by crew and day by day (E-04).
  const present = await prisma.attendanceRecord.findMany({
    where: { projectId: TL, status: "PRESENT" },
    select: { date: true, employeeProfile: { select: { crewMemberships: { where: { endDate: null }, select: { crewId: true } } } } },
  });
  const presentOn = new Map<string, number>();
  for (const row of present) {
    const date = row.date.toISOString().slice(0, 10);
    for (const membership of row.employeeProfile.crewMemberships) presentOn.set(`${date}:${membership.crewId}`, (presentOn.get(`${date}:${membership.crewId}`) ?? 0) + 1);
  }
  const crewSize = new Map((await prisma.workforceCrewMember.groupBy({ by: ["crewId"], where: { crewId: { in: CREWS.map((crew) => crew.id) }, endDate: null }, _count: { _all: true } })).map((row) => [row.crewId, row._count._all]));

  for (const [index, offset] of offsets.entries()) {
    const date = addLocalDays(today, offset);
    const id = `armaar_dl_tl_${String(index + 1).padStart(2, "0")}`;
    const at = (time: string) => instantFromLocal(date, time, ZONE);
    const next = (time: string) => instantFromLocal(addLocalDays(date, 1), time, ZONE);
    const status = statusOf(index);
    const weather: DailyLogWeatherCondition = index === 5 || index === 17 ? "RAIN" : index === 11 ? "WINDY" : index % 3 === 0 ? "CLOUDY" : index % 3 === 1 ? "CLEAR" : "PARTLY_CLOUDY";
    const wet = weather === "RAIN";
    const level = 9 + Math.floor(index / 8);
    const stage = ["formwork", "reinforcement", "pour", "curing and strike"][Math.floor(index / 2) % 4]!;
    const pour = stage === "pour";
    const facadeLevel = Math.min(1 + Math.floor(Math.max(index - 6, 0) / 3), 6);
    const submitted = status !== "DRAFT";
    const reviewed = status === "REVIEWED" || status === "LOCKED";

    await prisma.dailyLog.create({
      data: {
        id,
        companyId: company,
        projectId: TL,
        workDate: new Date(`${date}T12:00:00.000Z`),
        status,
        createdByMemberId: engineer,
        submittedByMemberId: submitted ? engineer : null,
        submittedAt: submitted ? at("17:45") : null,
        reviewerMemberId: pm,
        reviewedByMemberId: reviewed ? pm : null,
        reviewedAt: reviewed ? next("08:15") : null,
        lockedByMemberId: status === "LOCKED" ? pm : null,
        lockedAt: status === "LOCKED" ? next("08:25") : null,
        returnedByMemberId: status === "CORRECTION_REQUIRED" ? pm : null,
        returnedAt: status === "CORRECTION_REQUIRED" ? next("08:20") : null,
        returnReason: status === "CORRECTION_REQUIRED" ? "Add ElektroNord's headcount and the pump hours before I lock it." : null,
        submissionCount: submitted ? 1 : 0,
        version: submitted ? 8 + (index % 5) : 3,
        summary: `Tower A level ${level} slab — ${stage}. Tower B curtain wall on level ${facadeLevel}. MEP first fix continues on Tower A levels 5 to 8.${wet ? " Rain stopped external work in the afternoon." : ""}`,
        weatherSummary: wet ? "Rain from early afternoon, clearing by evening." : weather === "WINDY" ? "Strong north wind through the middle of the day." : "Dry.",
        siteCondition: wet ? "WET" : weather === "WINDY" ? "HIGH_WIND" : "DRY",
        delaySummary: wet ? "External work stopped for the rain." : weather === "WINDY" ? "Tower B crane stood down for wind." : null,
        weatherEntries: {
          create: [
            { companyId: company, observedAt: at("07:00"), temperatureC: dec(17 + (index % 6)), condition: wet ? "CLOUDY" : weather, windKph: dec(weather === "WINDY" ? 48 : 8 + (index % 7)), humidityPct: wet ? 78 : 55 + (index % 10) },
            { companyId: company, observedAt: at("13:00"), temperatureC: dec(22 + (index % 5)), condition: weather, precipitationMm: wet ? dec(7.5) : null, windKph: dec(weather === "WINDY" ? 62 : 12 + (index % 5)), humidityPct: wet ? 92 : 45 + (index % 12) },
          ],
        },
        workforce: {
          create: [
            ...CREWS.map((crew) => ({ companyId: company, organizationName: "BUILDING CONSTRUCTION INVEST", trade: crew.trade, crewName: crew.name, crewId: crew.id, headcount: presentOn.get(`${date}:${crew.id}`) ?? crewSize.get(crew.id) ?? 0 })),
            ...CONTRACTORS.filter((contractor) => index >= contractor.from && !(status === "CORRECTION_REQUIRED" && contractor.key === "elektronord")).map((contractor) => ({ companyId: company, organizationName: contractor.name, contractorId: contractorId(contractor.key), workPackageId: `armaar_wp_${contractor.key}`, trade: contractor.trade, headcount: contractor.base + ((index + contractor.base) % 4) })),
            { companyId: company, organizationName: "ARLIS - NDERTIM site team", trade: "Supervision", headcount: 5 },
          ],
        },
        workActivities: {
          create: [
            { companyId: company, title: `Tower A level ${level} slab — ${stage}`, projectArea: "Tower A", floorZone: `Level ${level}`, trade: "Concrete", progressPercent: dec(pour ? 100 : 25 * ((Math.floor(index / 2) % 4) + 1)), contractorId: contractorId("albabuild"), workPackageId: "armaar_wp_albabuild", createdByMemberId: engineer },
            ...(index >= 6 ? [{ companyId: company, title: `Curtain-wall units, Tower B level ${facadeLevel}`, projectArea: "Tower B — east elevation", floorZone: `Level ${facadeLevel}`, trade: "Façade", progressPercent: dec(30 + ((index * 7) % 60)), contractorId: contractorId("vlora_glass"), workPackageId: "armaar_wp_vlora_glass", createdByMemberId: engineer }] : []),
            { companyId: company, title: "MEP first fix, Tower A levels 5 to 8", projectArea: "Tower A", floorZone: "Levels 5 to 8", trade: "Mechanical & electrical", progressPercent: dec(Math.min(20 + index * 3, 90)), linkedTaskId: "armaar_task_120", contractorId: contractorId("elektronord"), workPackageId: "armaar_wp_elektronord", createdByMemberId: engineer },
            ...(index % 4 === 0 ? [{ companyId: company, title: "Basement wet areas — waterproofing", projectArea: "Basement", floorZone: "B1", trade: "Waterproofing", progressPercent: dec(Math.min(15 + index * 4, 95)), contractorId: contractorId("hidroizol"), workPackageId: "armaar_wp_hidroizol", createdByMemberId: engineer }] : []),
          ],
        },
        equipmentEntries: {
          create: [
            { companyId: company, equipmentName: "Tower crane TC-1", equipmentCode: "TC-1", quantity: 1, hoursUsed: dec(wet ? 4.5 : 8), status: "IN_USE" },
            { companyId: company, equipmentName: "Tower crane TC-2", equipmentCode: "TC-2", quantity: 1, hoursUsed: dec(weather === "WINDY" ? 2 : wet ? 4 : 7.5), status: weather === "WINDY" ? "IDLE" : "IN_USE", notes: weather === "WINDY" ? "Stood down from 10:30 for wind above the limit." : null },
            ...(pour ? [{ companyId: company, equipmentName: "Concrete pump 42 m", equipmentCode: "PMP-42", supplierId: supplierId("tirana_readymix", BCI), quantity: 1, hoursUsed: status === "CORRECTION_REQUIRED" ? null : dec(6.5), status: "IN_USE" as const }] : []),
            { companyId: company, equipmentName: "Passenger and goods hoist", equipmentCode: "HST-1", quantity: 1, hoursUsed: dec(9), status: "IN_USE" },
          ],
        },
        deliveryEntries: DELIVERIES[offset]
          ? { create: [{ companyId: company, description: DELIVERIES[offset]!.description, supplierId: supplierId(DELIVERIES[offset]!.supplier, BCI), purchaseOrderId: DELIVERIES[offset]!.order, goodsReceiptId: DELIVERIES[offset]!.receipt, inventoryReceiptId: DELIVERIES[offset]!.inventory ?? null, quantityText: DELIVERIES[offset]!.quantity, deliveredAt: at("07:30"), conditionNote: DELIVERIES[offset]!.condition }] }
          : undefined,
        visitorEntries: index % 6 === 2 ? { create: [{ companyId: company, ...VISITORS[Math.floor(index / 6) % VISITORS.length]!, arrivedAt: at("10:00"), departedAt: at("11:30"), escortedByMemberId: pm }] } : undefined,
        delayEntries: wet
          ? { create: [{ companyId: company, category: "WEATHER", title: "Rain stopped external work", startedAt: at("13:30"), endedAt: at("16:00"), durationMinutes: 150, impact: "MEDIUM", responsiblePartyText: "Weather" }] }
          : weather === "WINDY"
            ? { create: [{ companyId: company, category: "WEATHER", title: "Tower B crane stood down for wind", startedAt: at("10:30"), endedAt: at("15:00"), durationMinutes: 270, impact: "MEDIUM", responsiblePartyText: "Weather" }] }
            : index === DAYS - 3
              ? { create: [{ companyId: company, category: "MATERIAL", title: "Curtain-wall brackets for levels 7 to 12 not on site", description: "PR-2026-0052 is still waiting for approval; installers moved to sealing.", impact: "HIGH", responsiblePartyText: "BUILDING CONSTRUCTION INVEST — procurement" }] }
              : index === DAYS - 4
                ? { create: [{ companyId: company, category: "DESIGN", title: "Level 9 core wall openings on hold", description: "Waiting for the answer to RFI-009.", impact: "MEDIUM", responsiblePartyText: "ARLIS - NDERTIM — structural engineering", linkedTaskId: "armaar_task_003" }] }
                : undefined,
        instructionEntries:
          index === 8
            ? { create: [{ companyId: company, title: "Curtain-wall anchors at 1,500 mm on typical bays", description: "Per the answer to RFI-001: 1,500 mm on typical bays, 1,200 mm at the corners and the expansion joints.", issuedByText: "Architect", issuedByMemberId: memberId("bci.architect", BCI), recipientText: "Vlora Glass Systems", issuedAt: at("11:10"), requiresAction: false }] }
            : index === DAYS - 4
              ? { create: [{ companyId: company, title: "Hold the level 9 core wall openings", description: "Do not core W3 at level 9 until RFI-009 is answered.", issuedByText: "Structural engineer", issuedByMemberId: memberId("arlis.civil", BCI), recipientText: "AlbaBuild", issuedAt: at("09:20"), requiresAction: true, linkedTaskId: "armaar_task_003" }] }
              : undefined,
        taskLinks:
          index === DAYS - 4
            ? { create: [{ companyId: company, taskId: "armaar_task_003", linkType: "INSTRUCTION_ACTION", createdByMemberId: engineer }, { companyId: company, taskId: "armaar_task_120", linkType: "RELATED", createdByMemberId: engineer }] }
            : index === DAYS - 3
              ? { create: [{ companyId: company, taskId: "armaar_task_119", linkType: "FOLLOW_UP", createdByMemberId: engineer }] }
              : undefined,
        corrections: index === 4 ? { create: [{ companyId: company, reason: "Crane hours mistyped.", correctionSummary: "TC-1 ran 6 hours, not 16, per the operator's log.", createdByMemberId: pm, approvedByMemberId: pm, approvedAt: instantFromLocal(addLocalDays(date, 3), "09:00", ZONE) }] } : undefined,
      },
    });

    // Photos and the rebar delivery ticket, as stored files on the log (§36: photos/references).
    if (index >= DAYS - 5 || offset === -20) {
      const files = offset === -20 ? [{ name: "Rebar delivery tickets.pdf", category: "DELIVERY_TICKET" as const, caption: "Adriatik Steel tickets 1–11" }] : [{ name: `Tower B façade, level ${facadeLevel}.jpg`, category: "PHOTO" as const, caption: `Curtain wall from the promenade, ${date}` }];
      for (const [position, file] of files.entries()) {
        const documentId = `${id}_file_${position + 1}`;
        await seedStoredDocument(prisma, { id: documentId, companyId: company, name: file.name, projectId: TL, module: "dailyLogs", entityType: "daily_log", entityId: id, uploadedByMemberId: engineer, createdBy: userId("arlis.site-engineer") });
        await prisma.dailyLogDocumentLink.upsert({ where: { dailyLogId_documentId: { dailyLogId: id, documentId } }, update: {}, create: { companyId: company, dailyLogId: id, documentId, category: file.category, caption: file.caption, takenAt: file.category === "PHOTO" ? at("15:40") : null, sortOrder: position + 1 } });
      }
    }

    // The trail each recent log's history is read from.
    if (index >= DAYS - 6) {
      const history = [
        { action: "DAILY_LOG_CREATED", actor: engineer, at: at("07:10"), message: "started the daily log" },
        ...(submitted ? [{ action: "DAILY_LOG_SUBMITTED", actor: engineer, at: at("17:45"), message: "submitted the daily log" }] : []),
        ...(reviewed ? [{ action: "DAILY_LOG_REVIEWED", actor: pm, at: next("08:15"), message: "reviewed the daily log" }] : []),
        ...(status === "CORRECTION_REQUIRED" ? [{ action: "DAILY_LOG_RETURNED", actor: pm, at: next("08:20"), message: "returned the daily log for correction" }] : []),
      ];
      await prisma.activity.createMany({ data: history.map((entry, position) => ({ id: `armaar_act_${id}_${position + 1}`, companyId: company, module: "dailyLogs", entityType: "DailyLog", entityId: id, action: entry.action, message: entry.message, actorMemberId: entry.actor, actorUserId: entry.actor === pm ? userId("bci.pm") : userId("arlis.site-engineer"), metadata: { projectId: TL }, createdAt: entry.at })), skipDuplicates: true });
    }

    // Safety and quality records the day refers to, referenced and never changed (PRD #43 §63, §66).
    const references = [
      ...(offset === -5 ? [{ module: "hse", type: "toolbox_talk", target: SAFETY.talkFacade }] : []),
      ...(offset === -4 ? [{ module: "hse", type: "hazard", target: "armaar_hse_hz_tl_0033" }] : []),
      ...(offset === -8 ? [{ module: "qaqc", type: "quality_inspection", target: QUALITY.cubeTest }] : []),
    ];
    for (const reference of references) {
      const key = `daily_log:${id}:${reference.type}:${reference.target}`;
      await prisma.integrationLink.upsert({
        where: { companyId_integrationType_idempotencyKey: { companyId: company, integrationType: "DAILY_LOG_RECORD", idempotencyKey: key } },
        update: {},
        create: { companyId: company, integrationType: "DAILY_LOG_RECORD", mode: "REFERENCE", sourceModule: "dailyLogs", sourceEntityType: "daily_log", sourceEntityId: id, targetModule: reference.module, targetEntityType: reference.type, targetEntityId: reference.target, idempotencyKey: key, createdByMemberId: engineer },
      });
    }
  }

  return { logs: await prisma.dailyLog.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }) };
}
