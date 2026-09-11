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
  await seedContracts(prisma);
  await seedProcurement(prisma, members);
  await seedInventory(prisma, members);
  await seedQuality(prisma, members);
  await seedHse(prisma, members);
  await seedSupport(prisma, members);
}

/* Legal — 10 contracts, two awaiting approval (PRD #9 §75, §76) ------------- */

const CONTRACTS = [
  { reference: "CTR-001", title: "ACME main works contract", client: "client_acme", project: PROJECT_IDS.a, status: "ACTIVE", end: 240, value: 8400000 },
  { reference: "CTR-002", title: "Beta design appointment", client: "client_beta", project: PROJECT_IDS.b, status: "ACTIVE", end: 400, value: 620000 },
  { reference: "CTR-003", title: "Meridian concept services", client: "client_meridian", project: PROJECT_IDS.c, status: "PENDING_APPROVAL", end: 300, value: 180000 },
  { reference: "CTR-004", title: "Atlas survey framework", client: "client_atlas", project: PROJECT_IDS.d, status: "EXPIRING", end: 21, value: 95000 },
  { reference: "CTR-005", title: "Greenline feasibility agreement", client: "client_greenline", project: PROJECT_IDS.e, status: "DRAFT", end: 420, value: 45000 },
  { reference: "CTR-006", title: "Urban Core retention deed", client: "client_urban", project: PROJECT_IDS.f, status: "EXPIRED", end: -60, value: 120000 },
  { reference: "CTR-007", title: "Municipality framework agreement", client: "client_municipality", project: null, status: "PENDING_APPROVAL", end: 365, value: 250000 },
  { reference: "CTR-008", title: "Nova Living pre-construction", client: "client_nova", project: null, status: "ACTIVE", end: 180, value: 310000 },
  { reference: "CTR-009", title: "Delta consultancy retainer", client: "client_delta", project: null, status: "EXPIRING", end: 14, value: 60000 },
  { reference: "CTR-010", title: "Archive test contract", client: "client_archive", project: null, status: "ARCHIVED", end: -200, value: 30000 },
] as const;

async function seedContracts(prisma: PrismaClient) {
  let index = 0;
  for (const contract of CONTRACTS) {
    index += 1;
    const id = `contract_${index.toString().padStart(3, "0")}`;
    await prisma.contract.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        clientId: contract.client,
        projectId: contract.project,
        reference: contract.reference,
        title: contract.title,
        value: contract.value,
        currency: "EUR",
        status: contract.status,
        startDate: daysFromNow(-200),
        endDate: daysFromNow(contract.end),
        counterparty: contract.title.split(" ")[0],
        createdBy: "user_legal",
        archivedAt: contract.status === "ARCHIVED" ? daysFromNow(-150) : null,
        archivedBy: contract.status === "ARCHIVED" ? "user_legal" : null,
      },
    });
  }
}

/* Procurement — 12 requests, 8 orders (PRD #9 §77–§79) ---------------------- */

const REQUESTS = [
  { reference: "PR-001", title: "Reinforcement bar — block C", project: PROJECT_IDS.a, status: "PENDING_APPROVAL", amount: 48000 },
  { reference: "PR-002", title: "Ready-mix concrete C30/37", project: PROJECT_IDS.a, status: "APPROVED", amount: 92000 },
  { reference: "PR-003", title: "Scaffolding hire extension", project: PROJECT_IDS.a, status: "ORDERED", amount: 15600 },
  { reference: "PR-004", title: "Curtain wall package", project: PROJECT_IDS.b, status: "PENDING_APPROVAL", amount: 410000 },
  { reference: "PR-005", title: "Basement pumps", project: PROJECT_IDS.b, status: "SUBMITTED", amount: 22400 },
  { reference: "PR-006", title: "Site accommodation units", project: PROJECT_IDS.b, status: "APPROVED", amount: 18000 },
  { reference: "PR-007", title: "Marina survey equipment", project: PROJECT_IDS.c, status: "DRAFT", amount: 7400 },
  { reference: "PR-008", title: "Promenade paving samples", project: PROJECT_IDS.c, status: "REJECTED", amount: 3200 },
  { reference: "PR-009", title: "Yard drainage materials", project: PROJECT_IDS.d, status: "PENDING_APPROVAL", amount: 36800 },
  { reference: "PR-010", title: "Perimeter fencing", project: PROJECT_IDS.d, status: "APPROVED", amount: 27500 },
  { reference: "PR-011", title: "PPE restock", project: null, status: "ORDERED", amount: 4300 },
  { reference: "PR-012", title: "Office consumables", project: null, status: "SUBMITTED", amount: 1250 },
] as const;

const ORDERS = [
  { reference: "PO-001", supplier: "Adriatic Steel", project: PROJECT_IDS.a, status: "ORDERED", amount: 92000, request: "request_002" },
  { reference: "PO-002", supplier: "BetonPro", project: PROJECT_IDS.a, status: "DELIVERED", amount: 88000, request: null },
  { reference: "PO-003", supplier: "ScaffCo", project: PROJECT_IDS.a, status: "DELIVERED", amount: 15600, request: "request_003" },
  { reference: "PO-004", supplier: "Vitraline Facades", project: PROJECT_IDS.b, status: "PENDING_APPROVAL", amount: 410000, request: null },
  { reference: "PO-005", supplier: "HydroTek", project: PROJECT_IDS.b, status: "APPROVED", amount: 22400, request: null },
  { reference: "PO-006", supplier: "CabinWorks", project: PROJECT_IDS.b, status: "ORDERED", amount: 18000, request: "request_006" },
  { reference: "PO-007", supplier: "GeoDrain", project: PROJECT_IDS.d, status: "PENDING_APPROVAL", amount: 36800, request: null },
  { reference: "PO-008", supplier: "SafeGear", project: null, status: "DELIVERED", amount: 4300, request: "request_011" },
] as const;

async function seedProcurement(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const request of REQUESTS) {
    index += 1;
    const id = `request_${index.toString().padStart(3, "0")}`;
    const decided = request.status === "APPROVED" || request.status === "ORDERED" || request.status === "REJECTED";

    await prisma.purchaseRequest.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        projectId: request.project,
        requestedMemberId: members.get(request.project ? "user_pm" : "user_procurement")!,
        reference: request.reference,
        title: request.title,
        amount: request.amount,
        currency: "EUR",
        status: request.status,
        neededBy: daysFromNow(20 + index),
        createdBy: "user_procurement",
        approvedBy: decided ? "user_ceo" : null,
        approvedAt: decided ? daysFromNow(-5) : null,
      },
    });
  }

  index = 0;
  for (const order of ORDERS) {
    index += 1;
    const id = `order_${index.toString().padStart(3, "0")}`;
    const decided = order.status !== "PENDING_APPROVAL";

    await prisma.purchaseOrder.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        projectId: order.project,
        requestId: order.request,
        reference: order.reference,
        supplier: order.supplier,
        amount: order.amount,
        currency: "EUR",
        status: order.status,
        orderedAt: decided ? daysFromNow(-12) : null,
        expectedAt: daysFromNow(10 + index * 3),
        createdBy: "user_procurement",
        approvedBy: decided ? "user_ceo" : null,
        approvedAt: decided ? daysFromNow(-12) : null,
      },
    });
  }
}

/* Inventory — 20 items, 20 movements (PRD #9 §80–§82) ---------------------- */

const ITEMS = [
  { sku: "MAT-001", name: "Cement CEM II 42.5", unit: "bag", quantity: 480, reorder: 120, cost: 6.4 },
  { sku: "MAT-002", name: "Steel Reinforcement B500B 12mm", unit: "tonne", quantity: 24, reorder: 10, cost: 720 },
  { sku: "MAT-003", name: "Gypsum Board 12.5mm", unit: "sheet", quantity: 60, reorder: 150, cost: 8.9 },
  { sku: "MAT-004", name: "Electrical Cable NYM-J 3x2.5", unit: "metre", quantity: 2400, reorder: 500, cost: 1.4 },
  { sku: "MAT-005", name: "Interior Paint — White Matt", unit: "tin", quantity: 0, reorder: 40, cost: 22 },
  { sku: "MAT-006", name: "Porcelain Tiles 60x60", unit: "m²", quantity: 310, reorder: 100, cost: 18.5 },
  { sku: "MAT-007", name: "Mineral Wool Insulation 100mm", unit: "roll", quantity: 88, reorder: 60, cost: 26 },
  { sku: "MAT-008", name: "PVC Pipe DN110", unit: "metre", quantity: 640, reorder: 200, cost: 4.1 },
  { sku: "MAT-009", name: "Anchor Fasteners M12", unit: "box", quantity: 35, reorder: 50, cost: 31 },
  { sku: "MAT-010", name: "PPE Kit — Standard", unit: "kit", quantity: 46, reorder: 30, cost: 54 },
  { sku: "MAT-011", name: "Formwork Plywood 18mm", unit: "sheet", quantity: 210, reorder: 80, cost: 27 },
  { sku: "MAT-012", name: "Waterproof Membrane", unit: "roll", quantity: 18, reorder: 25, cost: 96 },
  { sku: "MAT-013", name: "Aggregate 0/32", unit: "tonne", quantity: 130, reorder: 60, cost: 19 },
  { sku: "MAT-014", name: "Timber Batten 50x50", unit: "metre", quantity: 1450, reorder: 400, cost: 1.9 },
  { sku: "MAT-015", name: "Sealant Cartridge", unit: "unit", quantity: 220, reorder: 100, cost: 5.6 },
  { sku: "MAT-016", name: "Fire-rated Door Set", unit: "unit", quantity: 6, reorder: 8, cost: 410 },
  { sku: "MAT-017", name: "Ceiling Grid System", unit: "m²", quantity: 275, reorder: 120, cost: 12.3 },
  { sku: "MAT-018", name: "Copper Pipe 22mm", unit: "metre", quantity: 380, reorder: 150, cost: 7.8 },
  { sku: "MAT-019", name: "LED Panel 600x600", unit: "unit", quantity: 92, reorder: 40, cost: 34 },
  { sku: "MAT-020", name: "Site Barrier Fencing", unit: "panel", quantity: 54, reorder: 20, cost: 48 },
] as const;

async function seedInventory(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const item of ITEMS) {
    index += 1;
    const id = `item_${index.toString().padStart(3, "0")}`;
    await prisma.inventoryItem.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        reorderLevel: item.reorder,
        unitCost: item.cost,
        location: index % 2 === 0 ? "Central Store" : "Riverside Site Store",
        createdBy: "user_inventory",
      },
    });
  }

  const types = ["IN", "OUT", "TRANSFER", "ADJUSTMENT"] as const;
  const projects = [PROJECT_IDS.a, PROJECT_IDS.b, PROJECT_IDS.d, null];

  for (let movement = 1; movement <= 20; movement += 1) {
    const id = `movement_${movement.toString().padStart(3, "0")}`;
    await prisma.inventoryMovement.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        itemId: `item_${(((movement - 1) % ITEMS.length) + 1).toString().padStart(3, "0")}`,
        projectId: projects[movement % projects.length],
        actorMemberId: members.get("user_inventory")!,
        type: types[movement % types.length],
        quantity: 5 + ((movement * 7) % 40),
        note: movement % 4 === 0 ? "Stock count adjustment" : null,
        createdBy: "user_inventory",
        createdAt: daysFromNow(-movement),
      },
    });
  }
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
