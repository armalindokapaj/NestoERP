/**
 * Module test records (PRD #9 §67–§87).
 *
 * Deliberately small: enough to exercise lists, details, statuses, scope,
 * approvals and dashboard widgets. These shapes are not the final ERP domain
 * models — each department module replaces its table when its own PRD lands
 * (PRD #9 §252).
 */
import type { PrismaClient } from "@prisma/client";

import { COMPANY_A, PROJECT_IDS, daysFromNow } from "./constants";

type Members = Map<string, string>;

export async function seedModuleRecords(prisma: PrismaClient, members: Members) {
  // Finance has its own seed now (prisma/seed/finance.ts): invoices with line
  // items, expenses, payments, budgets, commitments and approvals (PRD #15 §328).
  // HR has its own seed now (prisma/seed/hr.ts): employment records,
  // compensation, leave with balances, and attendance (PRD #16 §327).
  // Sales has its own seed now (prisma/seed/sales.ts): leads, opportunities,
  // proposals with line items, approvals, tasks and documents (PRD #17 §301).
  // Legal has its own seed now (prisma/seed/contracts.ts): contracts with
  // parties, obligations, amendments, approvals, tasks and documents
  // (PRD #18 §406).
  // Procurement has its own seed now (prisma/seed/procurement.ts): suppliers,
  // requests with items, RFQs with quotes, orders, receipts and approvals
  // (PRD #19 §440).
  // Inventory has its own seed now (prisma/seed/inventory.ts): items,
  // warehouses, locations, a movement ledger and the balances projected from it
  // (PRD #20 §301).
  await seedQuality(prisma, members);
  await seedHse(prisma, members);
  await seedSupport(prisma, members);
}

/* QA/QC — 12 records across four types (PRD #9 §83, §84) ------------------- */

const QUALITY = [
  { reference: "QA-001", type: "INSPECTION", title: "Block C foundation pour inspection", project: PROJECT_IDS.a, status: "CLOSED", severity: "LOW" },
  { reference: "QA-002", type: "NCR", title: "Rebar cover below tolerance", project: PROJECT_IDS.a, status: "OPEN", severity: "HIGH" },
  { reference: "QA-003", type: "PUNCH_ITEM", title: "Corridor finish defects — level 2", project: PROJECT_IDS.a, status: "IN_PROGRESS", severity: "LOW" },
  { reference: "QA-004", type: "TEST", title: "Concrete cube test — 28 day", project: PROJECT_IDS.a, status: "CLOSED", severity: "MEDIUM" },
  { reference: "QA-005", type: "INSPECTION", title: "Basement waterproofing inspection", project: PROJECT_IDS.b, status: "OPEN", severity: "MEDIUM" },
  { reference: "QA-006", type: "NCR", title: "Curtain wall alignment deviation", project: PROJECT_IDS.b, status: "IN_PROGRESS", severity: "HIGH" },
  { reference: "QA-007", type: "PUNCH_ITEM", title: "Lobby glazing scratches", project: PROJECT_IDS.b, status: "OPEN", severity: "LOW" },
  { reference: "QA-008", type: "TEST", title: "Fire damper functional test", project: PROJECT_IDS.b, status: "CLOSED", severity: "MEDIUM" },
  { reference: "QA-009", type: "INSPECTION", title: "Yard sub-base inspection", project: PROJECT_IDS.d, status: "OPEN", severity: "MEDIUM" },
  { reference: "QA-010", type: "NCR", title: "Drainage fall out of specification", project: PROJECT_IDS.d, status: "OPEN", severity: "CRITICAL" },
  { reference: "QA-011", type: "TEST", title: "Compaction test — yard", project: PROJECT_IDS.d, status: "IN_PROGRESS", severity: "MEDIUM" },
  { reference: "QA-012", type: "PUNCH_ITEM", title: "Gatehouse door adjustment", project: PROJECT_IDS.d, status: "CLOSED", severity: "LOW" },
] as const;

async function seedQuality(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const record of QUALITY) {
    index += 1;
    const id = `quality_${index.toString().padStart(3, "0")}`;
    await prisma.qualityRecord.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        projectId: record.project,
        assignedMemberId: members.get(index % 2 === 0 ? "user_engineer" : "user_qaqc")!,
        reference: record.reference,
        type: record.type,
        title: record.title,
        severity: record.severity,
        status: record.status,
        dueDate: daysFromNow(index * 3 - 6),
        closedAt: record.status === "CLOSED" ? daysFromNow(-index) : null,
        createdBy: "user_qaqc",
      },
    });
  }
}

/* HSE — 12 records across four types (PRD #9 §85, §86) --------------------- */

const HSE = [
  { reference: "HSE-001", type: "INCIDENT", title: "Minor hand injury — block A", project: PROJECT_IDS.a, status: "CLOSED", severity: "LOW" },
  { reference: "HSE-002", type: "INCIDENT", title: "Near miss — falling formwork clamp", project: PROJECT_IDS.a, status: "OPEN", severity: "HIGH" },
  { reference: "HSE-003", type: "INSPECTION", title: "Weekly site safety walk", project: PROJECT_IDS.a, status: "CLOSED", severity: "LOW" },
  { reference: "HSE-004", type: "PERMIT", title: "Hot works permit — roof plant", project: PROJECT_IDS.a, status: "IN_PROGRESS", severity: "MEDIUM" },
  { reference: "HSE-005", type: "CORRECTIVE_ACTION", title: "Install edge protection level 5", project: PROJECT_IDS.a, status: "OPEN", severity: "HIGH" },
  { reference: "HSE-006", type: "INSPECTION", title: "Scaffold handover inspection", project: PROJECT_IDS.b, status: "OPEN", severity: "MEDIUM" },
  { reference: "HSE-007", type: "PERMIT", title: "Confined space permit — basement", project: PROJECT_IDS.b, status: "IN_PROGRESS", severity: "HIGH" },
  { reference: "HSE-008", type: "INCIDENT", title: "Vehicle contact with hoarding", project: PROJECT_IDS.b, status: "CLOSED", severity: "MEDIUM" },
  { reference: "HSE-009", type: "INCIDENT", title: "Fuel spill in vehicle yard", project: PROJECT_IDS.d, status: "OPEN", severity: "CRITICAL" },
  { reference: "HSE-010", type: "CORRECTIVE_ACTION", title: "Replace damaged spill kit", project: PROJECT_IDS.d, status: "OPEN", severity: "MEDIUM" },
  { reference: "HSE-011", type: "INSPECTION", title: "Plant and equipment check", project: PROJECT_IDS.d, status: "IN_PROGRESS", severity: "LOW" },
  { reference: "HSE-012", type: "PERMIT", title: "Excavation permit — drainage run", project: PROJECT_IDS.d, status: "CLOSED", severity: "MEDIUM" },
] as const;

async function seedHse(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const record of HSE) {
    index += 1;
    const id = `hse_${index.toString().padStart(3, "0")}`;
    await prisma.hseRecord.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        projectId: record.project,
        assignedMemberId: members.get("user_hse")!,
        reference: record.reference,
        type: record.type,
        title: record.title,
        severity: record.severity,
        status: record.status,
        occurredAt: daysFromNow(-index * 2),
        closedAt: record.status === "CLOSED" ? daysFromNow(-index) : null,
        createdBy: "user_hse",
      },
    });
  }
}

/* Support — 3 requests (PRD #9 §87) ---------------------------------------- */

const SUPPORT = [
  { reference: "SUP-001", subject: "Password reset for site engineer", status: "RESOLVED", user: "user_it" },
  { reference: "SUP-002", subject: "Request access to Procurement module", status: "OPEN", user: "user_pm" },
  { reference: "SUP-003", subject: "Laptop replacement — Architecture", status: "IN_PROGRESS", user: "user_architect" },
] as const;

async function seedSupport(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const request of SUPPORT) {
    index += 1;
    const id = `support_${index.toString().padStart(3, "0")}`;
    await prisma.supportRequest.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        requestedMemberId: members.get(request.user)!,
        reference: request.reference,
        subject: request.subject,
        body: "Seeded support request used to exercise the Support module shell.",
        status: request.status,
        createdBy: request.user,
      },
    });
  }
}
