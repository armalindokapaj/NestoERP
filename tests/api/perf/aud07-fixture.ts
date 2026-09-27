import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Deterministic operational records for performance work (AUD-07 §3, PS-01, PS-05).
 *
 * One builder, two users: the D10 generator (`scripts/perf/d10-generate.ts`),
 * which grows a disposable database tenfold, and the 10→50 row query-growth
 * test (`aud07-list-query-growth.test.ts`), which needs more than fifty rows at
 * one company scope. Like every test fixture it writes rows directly rather
 * than through each domain's service, so it lives with the tests: it is not
 * product code, and never runs in the application.
 *
 * Everything is derived from the prefix, the family and the index — no clock,
 * no random source — so two runs build byte-identical rows and the checksum
 * proves it. Every id and every business number starts with the prefix, so the
 * fixture is removed by prefix and never touches a seeded row. People are the
 * company's existing members: a fixture never creates an identity (§3).
 * Binary uploads are not part of it: documents carry metadata only, and their
 * sizes are recorded apart from the record count (§3).
 */

export type FixtureCounts = {
  projects: number;
  clients: number;
  tasks: number;
  invoices: number;
  expenses: number;
  /** Pending finance approvals, each on one of this fixture's expenses (so ≤ expenses). */
  approvals: number;
  documents: number;
  dailyLogs: number;
  /** Units on one fixture project: buildings × floors × units per floor, rounded up to whole floors. */
  units: number;
};

export type FixtureSpec = {
  prefix: string;
  companyId: string;
  /** The user id written to `createdBy` columns. */
  createdByUserId: string;
  /** The member who creates records and is the approver's counterpart. */
  creatorMemberId: string;
  /** Another member of the company, who submits approvals (separation of duties). */
  submitterMemberId: string;
  counts: FixtureCounts;
};

export type FamilySummary = { rows: number; checksum: string };
export type FixtureSummary = {
  prefix: string;
  companyId: string;
  families: Record<keyof FixtureCounts, FamilySummary>;
  /** Expected register totals, by currency, as exact decimal strings (AUD-01 precision). */
  totals: { invoices: Record<string, string>; expenses: Record<string, string> };
  documentBytes: string;
  checksum: string;
};

const DAY = 86_400_000;
/** A fixed calendar origin: rows never depend on when they were generated. */
const ORIGIN = Date.UTC(2025, 0, 6);

function pick<T>(values: readonly T[], index: number, salt = 0): T {
  return values[(index * 7 + salt * 13) % values.length]!;
}

function money(index: number, salt: number): Prisma.Decimal {
  // 100.00 .. 99,999.99, deterministic, two decimals.
  const cents = ((index + 1) * 7_919 + salt * 104_729) % 9_990_000 + 10_000;
  return new Prisma.Decimal(cents).dividedBy(100);
}

function hashRows(rows: unknown[]): string {
  const hash = createHash("sha256");
  for (const row of rows) hash.update(JSON.stringify(row, (_, value) => (typeof value === "bigint" ? value.toString() : value instanceof Prisma.Decimal ? value.toFixed(2) : value)));
  return hash.digest("hex").slice(0, 16);
}

/** Id of the `index`th row of `family`. */
export function fixtureId(prefix: string, family: string, index: number): string {
  return `${prefix}_${family}_${String(index).padStart(5, "0")}`;
}

const TASK_STATUSES = ["TODO", "TODO", "IN_PROGRESS", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "CRITICAL"] as const;
const INVOICE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "SENT", "SENT"] as const;
const EXPENSE_STATUSES = ["DRAFT", "APPROVED", "APPROVED", "REJECTED"] as const;
const CATEGORIES = ["LABOR", "MATERIALS", "EQUIPMENT", "SUBCONTRACTOR", "SERVICES", "TRAVEL", "ADMINISTRATION", "OTHER"] as const;
const CURRENCIES = ["EUR", "EUR", "EUR", "ALL", "USD"] as const;
const EXTENSIONS = [
  ["pdf", "application/pdf"],
  ["dwg", "application/acad"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["jpg", "image/jpeg"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
] as const;
const DAILY_LOG_STATUSES = ["DRAFT", "SUBMITTED", "REVIEWED", "LOCKED"] as const;
const PROJECT_STATUSES = ["ACTIVE", "ACTIVE", "PENDING", "FINISHED"] as const;

/** Builds the fixture in `db`. Call `removeOperationalFixture` first when re-running with the same prefix. */
export async function buildOperationalFixture(db: PrismaClient, spec: FixtureSpec): Promise<FixtureSummary> {
  const { prefix, companyId, createdByUserId: createdBy, creatorMemberId, submitterMemberId, counts } = spec;
  const id = (family: string, index: number) => fixtureId(prefix, family, index);
  const code = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  const families = {} as Record<keyof FixtureCounts, FamilySummary>;
  const batch = async <T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) => {
    for (let start = 0; start < rows.length; start += 1_000) await write(rows.slice(start, start + 1_000));
  };

  // Projects: at least one, so daily logs, units and tasks have somewhere to live.
  const projectCount = Math.max(1, counts.projects);
  const projects = Array.from({ length: projectCount }, (_, index) => ({
    id: id("project", index),
    companyId,
    code: `${code}-P${String(index).padStart(4, "0")}`,
    name: `${index % 3 === 0 ? "Residence" : index % 3 === 1 ? "Tower" : "Logistics hub"} ${prefix} ${index}`,
    status: pick(PROJECT_STATUSES, index),
    city: pick(["Tirana", "Durrës", "Vlorë", "Shkodër"], index),
    startDate: new Date(ORIGIN + (index % 400) * DAY),
    createdBy,
  }));
  await batch(projects, (data) => db.project.createMany({ data }));
  families.projects = { rows: projects.length, checksum: hashRows(projects) };
  const projectOf = (index: number) => projects[index % projects.length]!.id;

  const clientCount = Math.max(1, counts.clients);
  const clients = Array.from({ length: clientCount }, (_, index) => ({
    id: id("client", index),
    companyId,
    code: `${code}-C${String(index).padStart(5, "0")}`,
    name: `${prefix} client ${index}${index % 11 === 0 ? " with a deliberately long trading name that wraps in narrow columns" : ""}`,
    normalizedName: `${prefix} client ${index}`,
    status: index % 17 === 0 ? ("INACTIVE" as const) : ("ACTIVE" as const),
    city: pick(["Tirana", "Durrës", "Elbasan"], index),
    createdBy,
  }));
  await batch(clients, (data) => db.client.createMany({ data }));
  families.clients = { rows: clients.length, checksum: hashRows(clients) };

  const tasks = Array.from({ length: counts.tasks }, (_, index) => {
    const status = pick(TASK_STATUSES, index);
    return {
      id: id("task", index),
      companyId,
      projectId: index % 5 === 0 ? null : projectOf(index),
      title: `${prefix} task ${index}`,
      status,
      priority: pick(PRIORITIES, index, 1),
      assigneeMemberId: index % 3 === 0 ? submitterMemberId : creatorMemberId,
      createdByMemberId: creatorMemberId,
      dueDate: new Date(ORIGIN + ((index % 120) - 30) * DAY),
      completedAt: status === "COMPLETED" ? new Date(ORIGIN + (index % 90) * DAY) : null,
      blockedAt: status === "BLOCKED" ? new Date(ORIGIN + (index % 60) * DAY) : null,
      blockedReason: status === "BLOCKED" ? "Waiting for materials" : null,
      createdBy,
    };
  });
  await batch(tasks, (data) => db.task.createMany({ data }));
  families.tasks = { rows: tasks.length, checksum: hashRows(tasks) };

  const invoiceTotals: Record<string, Prisma.Decimal> = {};
  const invoices = Array.from({ length: counts.invoices }, (_, index) => {
    const subtotal = money(index, 1);
    const taxAmount = subtotal.times(0.2).toDecimalPlaces(2);
    const totalAmount = subtotal.plus(taxAmount);
    const currency = pick(CURRENCIES, index);
    invoiceTotals[currency] = (invoiceTotals[currency] ?? new Prisma.Decimal(0)).plus(totalAmount);
    const issueDate = new Date(ORIGIN + (index % 365) * DAY);
    return {
      id: id("invoice", index),
      companyId,
      invoiceNumber: `${code}-INV-${String(index).padStart(6, "0")}`,
      clientId: clients[index % clients.length]!.id,
      projectId: index % 4 === 0 ? null : projectOf(index),
      issueDate,
      dueDate: new Date(issueDate.getTime() + 30 * DAY),
      currency,
      subtotal,
      taxAmount,
      totalAmount,
      status: pick(INVOICE_STATUSES, index),
      createdByMemberId: creatorMemberId,
    };
  });
  await batch(invoices, (data) => db.invoice.createMany({ data }));
  families.invoices = { rows: invoices.length, checksum: hashRows(invoices) };

  const expenseTotals: Record<string, Prisma.Decimal> = {};
  const expenses = Array.from({ length: Math.max(counts.expenses, counts.approvals) }, (_, index) => {
    const netAmount = money(index, 2);
    const taxAmount = netAmount.times(0.2).toDecimalPlaces(2);
    const totalAmount = netAmount.plus(taxAmount);
    const currency = pick(CURRENCIES, index, 1);
    expenseTotals[currency] = (expenseTotals[currency] ?? new Prisma.Decimal(0)).plus(totalAmount);
    return {
      id: id("expense", index),
      companyId,
      expenseNumber: `${code}-EXP-${String(index).padStart(6, "0")}`,
      projectId: index % 3 === 0 ? null : projectOf(index),
      expenseDate: new Date(ORIGIN + (index % 365) * DAY),
      category: pick(CATEGORIES, index),
      description: `${prefix} expense ${index}`,
      payeeName: `Supplier ${index % 23}`,
      currency,
      netAmount,
      taxAmount,
      totalAmount,
      // The first `approvals` expenses wait for a decision; the rest spread over the other states.
      status: index < counts.approvals ? ("PENDING_APPROVAL" as const) : pick(EXPENSE_STATUSES, index),
      createdByMemberId: submitterMemberId,
    };
  });
  await batch(expenses, (data) => db.expense.createMany({ data }));
  families.expenses = { rows: expenses.length, checksum: hashRows(expenses) };

  const approvals = Array.from({ length: counts.approvals }, (_, index) => ({
    id: id("approval", index),
    companyId,
    recordType: "EXPENSE" as const,
    recordId: expenses[index]!.id,
    status: "PENDING" as const,
    submittedByMemberId: submitterMemberId,
    submittedAt: new Date(ORIGIN + (index % 200) * DAY),
  }));
  await batch(approvals, (data) => db.financeApproval.createMany({ data }));
  families.approvals = { rows: approvals.length, checksum: hashRows(approvals) };

  let documentBytes = BigInt(0);
  const documents = Array.from({ length: counts.documents }, (_, index) => {
    const [extension, mimeType] = pick(EXTENSIONS, index);
    const sizeBytes = BigInt(20_000 + ((index * 104_729) % 8_000_000));
    documentBytes += sizeBytes;
    const name = `${prefix}-document-${index}.${extension}`;
    return {
      id: id("document", index),
      companyId,
      name,
      originalFileName: name,
      fileName: name,
      extension,
      mimeType,
      sizeBytes,
      storageKey: `perf/${prefix}/documents/${index}`,
      storageStatus: "AVAILABLE" as const,
      latestVersionNumber: 1,
      projectId: index % 4 === 3 ? null : projectOf(index),
      clientId: index % 4 === 3 ? clients[index % clients.length]!.id : null,
      uploadedByMemberId: creatorMemberId,
      uploadedAt: new Date(ORIGIN + (index % 365) * DAY),
      availableAt: new Date(ORIGIN + (index % 365) * DAY),
      createdBy,
    };
  });
  await batch(documents, (data) => db.document.createMany({ data }));
  const versions = documents.map((document, index) => ({
    id: id("docversion", index),
    companyId,
    documentId: document.id,
    versionNumber: 1,
    storageKey: `perf/${prefix}/versions/${index}`,
    originalFileName: document.originalFileName,
    fileName: document.fileName,
    extension: document.extension,
    mimeTypeDeclared: document.mimeType,
    sizeBytes: document.sizeBytes,
    storageStatus: "AVAILABLE" as const,
    uploadedByMemberId: creatorMemberId,
    availableAt: document.availableAt,
  }));
  await batch(versions, (data) => db.documentVersion.createMany({ data }));
  if (documents.length > 0) {
    await db.$executeRaw`UPDATE "documents" SET "currentVersionId" = replace("id", ${`${prefix}_document_`}, ${`${prefix}_docversion_`}) WHERE "id" LIKE ${`${prefix}\\_document\\_%`}`;
  }
  families.documents = { rows: documents.length, checksum: hashRows(documents) };

  // Daily logs: one per project and day, on consecutive days of the fixture's projects.
  const dailyLogs = Array.from({ length: counts.dailyLogs }, (_, index) => {
    const project = projects[index % projects.length]!;
    const day = Math.floor(index / projects.length);
    const status = pick(DAILY_LOG_STATUSES, index);
    return {
      id: id("dailylog", index),
      companyId,
      projectId: project.id,
      workDate: new Date(ORIGIN + day * DAY),
      status,
      createdByMemberId: creatorMemberId,
      submittedByMemberId: status === "DRAFT" ? null : creatorMemberId,
      submittedAt: status === "DRAFT" ? null : new Date(ORIGIN + day * DAY + 18 * 3_600_000),
      summary: `${prefix} site day ${day}`,
    };
  });
  await batch(dailyLogs, (data) => db.dailyLog.createMany({ data }));
  families.dailyLogs = { rows: dailyLogs.length, checksum: hashRows(dailyLogs) };

  families.units = await buildUnits(db, spec, projects[0]!.id);

  const decimalTotals = (totals: Record<string, Prisma.Decimal>) => Object.fromEntries(Object.entries(totals).sort().map(([currency, value]) => [currency, value.toFixed(2)]));
  const summary: Omit<FixtureSummary, "checksum"> = {
    prefix,
    companyId,
    families,
    totals: { invoices: decimalTotals(invoiceTotals), expenses: decimalTotals(expenseTotals) },
    documentBytes: documentBytes.toString(),
  };
  return { ...summary, checksum: hashRows([summary]) };
}

async function buildUnits(db: PrismaClient, spec: FixtureSpec, projectId: string): Promise<FamilySummary> {
  const { prefix, companyId, createdByUserId: createdBy, counts } = spec;
  if (counts.units <= 0) return { rows: 0, checksum: hashRows([]) };
  const types = await db.projectUnitType.findMany({ where: { companyId, isActive: true }, orderBy: { code: "asc" }, select: { id: true } });
  if (types.length === 0) throw new Error(`The company has no active unit types; units cannot be generated.`);
  const perFloor = 8;
  const floors = Math.ceil(counts.units / perFloor);
  const floorsPerBuilding = 20;
  const buildingCount = Math.ceil(floors / floorsPerBuilding);
  const key = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();

  const buildings = Array.from({ length: buildingCount }, (_, b) => ({ id: fixtureId(prefix, "building", b), companyId, projectId, name: `Block ${b + 1}`, nameKey: key(`Block ${b + 1}`), sortOrder: b + 1, createdBy }));
  await db.projectBuilding.createMany({ data: buildings });
  const floorRows = Array.from({ length: floors }, (_, index) => {
    const b = Math.floor(index / floorsPerBuilding);
    const f = index % floorsPerBuilding;
    const levelType = f === 0 ? ("GROUND" as const) : ("STANDARD" as const);
    return { id: fixtureId(prefix, "floor", index), companyId, projectId, buildingId: buildings[b]!.id, number: f, name: `Floor ${f}`, levelType, floorKey: `${levelType}:${f}`, sortOrder: f + 1, createdBy };
  });
  await db.projectFloor.createMany({ data: floorRows });
  const units = Array.from({ length: counts.units }, (_, index) => {
    const floor = floorRows[Math.floor(index / perFloor)]!;
    const u = index % perFloor;
    const unitCode = `B${Math.floor(Math.floor(index / perFloor) / floorsPerBuilding) + 1}-${floor.number}${String(u + 1).padStart(2, "0")}`;
    return {
      id: fixtureId(prefix, "unit", index),
      companyId,
      projectId,
      floorId: floor.id,
      unitCode,
      unitCodeKey: key(unitCode),
      unitTypeId: types[index % types.length]!.id,
      orientation: (["N", "E", "S", "W"] as const)[u % 4],
      internalArea: new Prisma.Decimal(40 + ((index * 7) % 120)),
      saleableArea: new Prisma.Decimal(48 + ((index * 7) % 130)),
      bedrooms: u % 4,
      sortOrder: u + 1,
      createdBy,
    };
  });
  for (let start = 0; start < units.length; start += 1_000) await db.projectUnit.createMany({ data: units.slice(start, start + 1_000) });
  return { rows: units.length, checksum: hashRows(units) };
}

/** Removes every row a fixture with this prefix created, children first. Seeded rows never match a prefix. */
export async function removeOperationalFixture(db: PrismaClient, prefix: string): Promise<void> {
  const starts = { startsWith: `${prefix}_` };
  const projectIds = (await db.project.findMany({ where: { id: starts }, select: { id: true } })).map((row) => row.id);
  const expenseIds = (await db.expense.findMany({ where: { id: starts }, select: { id: true } })).map((row) => row.id);
  // Anything the application attached to fixture records while a test ran.
  await db.financeApproval.deleteMany({ where: { OR: [{ id: starts }, { recordId: { in: expenseIds } }] } });
  await db.projectUnit.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.projectFloor.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.projectBuilding.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.dailyLog.deleteMany({ where: { id: starts } });
  await db.document.updateMany({ where: { id: starts }, data: { currentVersionId: null } });
  await db.documentVersion.deleteMany({ where: { id: starts } });
  await db.document.deleteMany({ where: { id: starts } });
  await db.invoice.deleteMany({ where: { id: starts } });
  await db.expense.deleteMany({ where: { id: starts } });
  await db.task.deleteMany({ where: { id: starts } });
  await db.project.deleteMany({ where: { id: starts } });
  await db.client.deleteMany({ where: { id: starts } });
}
