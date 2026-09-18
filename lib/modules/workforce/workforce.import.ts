import type { EmploymentType, Prisma, WorkerCategory } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { createImportedEmployment } from "@/lib/modules/hr/employees/employee.doors";
import { dbDay, isDay, todayDay, type Day } from "@/lib/modules/hr/employment/employment.dates";
import { EMPLOYMENT_TYPES, WORKER_CATEGORIES } from "@/lib/modules/hr/hr.schema";
import { employmentTypeLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";
import { parseCsv } from "@/lib/utils/csv";
import { seesWholeCompany, workforceProjectWhere } from "./workforce.permissions";

/**
 * Adding the workforce in bulk (E-04 §93-§98, §163, §188, §189, §224, §225, §273).
 *
 * A construction company takes on hundreds of people at once, most of whom
 * will never sign in. HR uploads a CSV; every row is checked before anything is
 * written — required names, dates, the company's own trades, departments,
 * projects, sites and crews, employee codes already taken or repeated in the
 * file, and people the group may already have — and the preview says, row by
 * row, what is wrong. Committing re-checks each row, then makes each good one
 * in its own transaction through HR's door: the person, the employment and its
 * history, and — when the row names them — the project assignment and the
 * crew. No login is made (§98); pay is never imported here (§95).
 */

export const IMPORT_MAX_ROWS = 2000;
const IMPORT_MAX_CHARS = 2_000_000;
const PARALLEL = 4;

export const IMPORT_FIELDS = ["employeeNumber", "firstName", "lastName", "trade", "workerCategory", "jobTitle", "department", "startDate", "employmentType", "phone", "project", "site", "crew", "accountRequired"] as const;
type Field = (typeof IMPORT_FIELDS)[number];

/** The column headings a file may use for each field, lower-cased. */
const HEADINGS: Record<Field, string[]> = {
  employeeNumber: ["employee code", "code", "employee number", "employee no", "employee no."],
  firstName: ["first name", "firstname", "given name"],
  lastName: ["last name", "lastname", "surname", "family name"],
  trade: ["trade", "profession"],
  workerCategory: ["category", "worker category"],
  jobTitle: ["job title", "title", "position"],
  department: ["department"],
  startDate: ["start date", "employment start date", "started", "hire date"],
  employmentType: ["employment type", "contract type", "type"],
  phone: ["phone", "work phone", "mobile"],
  project: ["project", "project code"],
  site: ["site"],
  crew: ["crew"],
  accountRequired: ["account required", "account required?", "nesto account"],
};
const PAY_HEADINGS = ["salary", "rate", "pay", "wage", "hourly rate", "daily rate", "monthly salary", "gross salary"];

export const IMPORT_TEMPLATE = [
  "Employee code,First name,Last name,Trade,Category,Job title,Department,Start date,Employment type,Phone,Project,Site,Crew,Account required",
  "W-0001,Arben,Hoxha,Mason,Construction worker,Mason,,2026-09-01,Full time,+355 69 000 0000,,,,No",
].join("\n");

export type ImportRowDTO = { line: number; name: string; values: Partial<Record<Field, string>>; errors: string[]; warnings: string[] };
export type ImportBatchDTO = {
  id: string;
  fileName: string;
  status: "PREVIEWED" | "COMMITTED" | "DISCARDED";
  rowCount: number;
  validCount: number;
  errorCount: number;
  warningCount: number;
  createdCount: number;
  ignoredColumns: string[];
  rows: ImportRowDTO[];
};
export type ImportResultDTO = { batchId: string; createdCount: number; assignedCount: number; crewedCount: number; failed: Array<{ line: number; name: string; message: string }> };

type StoredRows = { ignoredColumns: string[]; rows: ImportRowDTO[] };

type Resolved = {
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  tradeId: string | null;
  workerCategory: WorkerCategory | null;
  jobTitle: string | null;
  departmentId: string | null;
  startDate: Day;
  employmentType: EmploymentType;
  phone: string | null;
  projectId: string | null;
  siteId: string | null;
  crewId: string | null;
};

const key = (value: string) => value.trim().toLowerCase();
const clean = (value: string | undefined) => (value ?? "").trim();

function assertImporter(context: UserContext): void {
  assertModule(context, "hr");
  assertPermission(context, "hr.employee.import");
}

/* -------------------------------------------------------------------------- */
/* Reading the file                                                            */
/* -------------------------------------------------------------------------- */

function readFile(csv: string): { rows: Array<{ line: number; values: Partial<Record<Field, string>> }>; ignoredColumns: string[] } {
  if (csv.length > IMPORT_MAX_CHARS) throw new AccessError("VALIDATION_ERROR", "The file is too large. Split it into files of up to 2,000 people.", { csv: ["The file is too large."] });
  const table = parseCsv(csv);
  if (table.length < 2) throw new AccessError("VALIDATION_ERROR", "The file has no rows under its headings.", { csv: ["The file has no rows under its headings."] });
  const headings = table[0]!.map(key);
  const columns = new Map<number, Field>();
  const ignoredColumns: string[] = [];
  headings.forEach((heading, index) => {
    const field = IMPORT_FIELDS.find((candidate) => HEADINGS[candidate].includes(heading));
    if (field && ![...columns.values()].includes(field)) columns.set(index, field);
    else if (heading) ignoredColumns.push(table[0]![index]!.trim());
  });
  if (![...columns.values()].includes("firstName") || ![...columns.values()].includes("lastName")) {
    throw new AccessError("VALIDATION_ERROR", "The file needs a First name and a Last name column.", { csv: ["The file needs a First name and a Last name column."] });
  }
  const body = table.slice(1);
  if (body.length > IMPORT_MAX_ROWS) throw new AccessError("VALIDATION_ERROR", `A file can hold up to ${IMPORT_MAX_ROWS.toLocaleString("en")} people. Split it and import each part.`, { csv: ["Too many rows."] });
  return {
    ignoredColumns,
    rows: body.map((cells, index) => {
      const values: Partial<Record<Field, string>> = {};
      for (const [column, field] of columns) {
        // A spreadsheet-safe cell written with a leading apostrophe is read back as its text.
        const raw = clean(cells[column]);
        values[field] = raw.startsWith("'") ? raw.slice(1) : raw;
      }
      return { line: index + 2, values };
    }),
  };
}

function parseDay(value: string): Day | null {
  if (!value) return null;
  if (isDay(value)) return value;
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  if (!match) return null;
  const candidate = `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  return isDay(candidate) ? candidate : null;
}

function parseEnum<T extends string>(value: string, keys: readonly T[], labels: Record<T, string>): T | undefined {
  const wanted = key(value).replace(/[\s-]+/g, "_");
  return keys.find((candidate) => candidate.toLowerCase() === wanted || key(labels[candidate]).replace(/[\s-]+/g, "_") === wanted);
}

/* -------------------------------------------------------------------------- */
/* Checking every row                                                          */
/* -------------------------------------------------------------------------- */

async function check(context: UserContext, rows: Array<{ line: number; values: Partial<Record<Field, string>> }>): Promise<Array<ImportRowDTO & { resolved: Resolved | null }>> {
  const lastNames = [...new Set(rows.map((row) => clean(row.values.lastName)).filter(Boolean))];
  const codes = [...new Set(rows.map((row) => clean(row.values.employeeNumber)).filter(Boolean))];
  const phones = [...new Set(rows.map((row) => clean(row.values.phone)).filter(Boolean))];
  const [trades, departments, projects, crews, takenCodes, people] = await Promise.all([
    prisma.workforceTrade.findMany({ where: { companyId: context.companyId, isActive: true }, select: { id: true, name: true, code: true } }),
    prisma.department.findMany({ where: { companyId: context.companyId, status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { AND: [workforceProjectWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }] }, select: { id: true, name: true, code: true, sites: { where: { status: "ACTIVE" }, select: { id: true, name: true } } } }),
    prisma.workforceCrew.findMany({ where: { companyId: context.companyId, status: "ACTIVE", ...(seesWholeCompany(context) ? {} : { project: { is: workforceProjectWhere(context) } }) }, select: { id: true, name: true, projectId: true } }),
    codes.length ? prisma.employeeProfile.findMany({ where: { companyId: context.companyId, employeeNumber: { in: codes } }, select: { employeeNumber: true } }) : [],
    lastNames.length || phones.length
      ? prisma.personProfile.findMany({
          where: { parentGroupId: context.parentGroupId, OR: [...(lastNames.length ? [{ lastName: { in: lastNames, mode: "insensitive" as const } }] : []), ...(phones.length ? [{ workPhone: { in: phones } }, { personalPhone: { in: phones } }] : [])] },
          select: { firstName: true, lastName: true, workPhone: true, personalPhone: true },
        })
      : [],
  ]);

  const tradeBy = new Map<string, string>();
  for (const trade of trades) {
    tradeBy.set(key(trade.name), trade.id);
    if (trade.code) tradeBy.set(key(trade.code), trade.id);
  }
  const departmentBy = new Map(departments.map((row) => [key(row.name), row.id]));
  const projectBy = new Map<string, (typeof projects)[number]>();
  for (const project of projects) {
    projectBy.set(key(project.name), project);
    if (project.code) projectBy.set(key(project.code), project);
  }
  const crewBy = new Map(crews.map((row) => [key(row.name), row]));
  const taken = new Set(takenCodes.map((row) => key(row.employeeNumber ?? "")));
  const knownNames = new Set(people.map((person) => `${key(person.firstName)}|${key(person.lastName)}`));
  const knownPhones = new Set(people.flatMap((person) => [person.workPhone, person.personalPhone]).filter((phone): phone is string => Boolean(phone)));
  const seenCodes = new Map<string, number>();
  const seenNames = new Map<string, number>();
  const mayAssign = can(context, "workforce.view") && can(context, "workforce.project_assignment.manage");
  const mayCrew = can(context, "workforce.view") && can(context, "workforce.crew.manage");
  const today = todayDay();

  return rows.map(({ line, values }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const firstName = clean(values.firstName);
    const lastName = clean(values.lastName);
    const name = [firstName, lastName].filter(Boolean).join(" ") || `Row ${line}`;
    if (!firstName) errors.push("First name is missing.");
    if (!lastName) errors.push("Last name is missing.");
    if (firstName.length > 100 || lastName.length > 100) errors.push("A name is longer than 100 characters.");

    const code = clean(values.employeeNumber) || null;
    if (code) {
      if (code.length > 40) errors.push("The employee code is longer than 40 characters.");
      if (taken.has(key(code))) errors.push(`Employee code ${code} is already used in this company.`);
      const earlier = seenCodes.get(key(code));
      if (earlier) errors.push(`Employee code ${code} is also on row ${earlier}.`);
      else seenCodes.set(key(code), line);
    }

    // People the group may already have, and people twice in this file: flagged, never refused (§92, §225).
    const nameKey = `${key(firstName)}|${key(lastName)}`;
    const phone = clean(values.phone) || null;
    if (firstName && lastName && knownNames.has(nameKey)) warnings.push("Somebody with this name is already in the group. Check it is not them.");
    if (phone && knownPhones.has(phone)) warnings.push("Somebody in the group already has this phone number.");
    const twin = seenNames.get(nameKey);
    if (firstName && lastName && twin) warnings.push(`The same name is also on row ${twin}.`);
    else if (firstName && lastName) seenNames.set(nameKey, line);

    const tradeText = clean(values.trade);
    const tradeId = tradeText ? (tradeBy.get(key(tradeText)) ?? null) : null;
    if (tradeText && !tradeId) errors.push(`${tradeText} is not one of this company's trades. Add it under Workforce → Trades first.`);

    const categoryText = clean(values.workerCategory);
    const workerCategory = categoryText ? parseEnum(categoryText, WORKER_CATEGORIES, workerCategoryLabels) : undefined;
    if (categoryText && !workerCategory) errors.push(`${categoryText} is not a worker category.`);

    const typeText = clean(values.employmentType);
    const employmentType = typeText ? parseEnum(typeText, EMPLOYMENT_TYPES, employmentTypeLabels) : "FULL_TIME";
    if (!employmentType) errors.push(`${typeText} is not an employment type.`);

    const departmentText = clean(values.department);
    const departmentId = departmentText ? (departmentBy.get(key(departmentText)) ?? null) : null;
    if (departmentText && !departmentId) errors.push(`${departmentText} is not one of this company's departments.`);

    const startText = clean(values.startDate);
    const startDate = startText ? parseDay(startText) : today;
    if (startText && !startDate) errors.push(`${startText} is not a date. Write it as YYYY-MM-DD.`);
    if (!startText) warnings.push("No start date: they start today.");

    const projectText = clean(values.project);
    const project = projectText ? projectBy.get(key(projectText)) : undefined;
    if (projectText && !project) errors.push(`${projectText} is not one of your projects.`);
    if (projectText && !mayAssign) errors.push("You cannot assign people to projects.");
    const siteText = clean(values.site);
    const site = siteText && project ? project.sites.find((candidate) => key(candidate.name) === key(siteText)) : undefined;
    if (siteText && !projectText) errors.push("A site needs its project.");
    else if (siteText && project && !site) errors.push(`${siteText} is not a site of ${project.name}.`);

    const crewText = clean(values.crew);
    const crew = crewText ? crewBy.get(key(crewText)) : undefined;
    if (crewText && !crew) errors.push(`${crewText} is not one of your crews.`);
    if (crewText && !mayCrew) errors.push("You cannot put people in crews.");
    if (crew?.projectId && project && crew.projectId !== project.id) errors.push(`${crew.name} works on another project.`);

    if (/^(y|yes|true|1|po)$/i.test(clean(values.accountRequired))) warnings.push("An import makes no NESTO account. Request one from their HR page afterwards.");
    if (startDate && startDate > today) warnings.push(`Planned: they start on ${startDate}.`);

    const resolved: Resolved | null = errors.length
      ? null
      : {
          employeeNumber: code,
          firstName,
          lastName,
          tradeId,
          workerCategory: workerCategory ?? null,
          jobTitle: clean(values.jobTitle).slice(0, 200) || null,
          departmentId,
          startDate: startDate!,
          employmentType: employmentType!,
          phone,
          projectId: project?.id ?? null,
          siteId: site?.id ?? null,
          crewId: crew?.id ?? null,
        };
    return { line, name, values, errors, warnings, resolved };
  });
}

function toBatchDTO(row: { id: string; fileName: string; status: ImportBatchDTO["status"]; rowCount: number; validCount: number; errorCount: number; warningCount: number; createdCount: number; rows: Prisma.JsonValue }): ImportBatchDTO {
  const stored = row.rows as unknown as StoredRows;
  return { id: row.id, fileName: row.fileName, status: row.status, rowCount: row.rowCount, validCount: row.validCount, errorCount: row.errorCount, warningCount: row.warningCount, createdCount: row.createdCount, ignoredColumns: stored.ignoredColumns, rows: stored.rows };
}

const BATCH_SELECT = { id: true, fileName: true, status: true, rowCount: true, validCount: true, errorCount: true, warningCount: true, createdCount: true, rows: true } as const;

/* -------------------------------------------------------------------------- */
/* Preview, commit, discard                                                    */
/* -------------------------------------------------------------------------- */

/** Checks a file and keeps the result as a batch; nothing else is written (§96). */
export async function previewImport(context: UserContext, input: { fileName: string; csv: string }): Promise<ImportBatchDTO> {
  assertImporter(context);
  const file = readFile(input.csv);
  const checked = await check(context, file.rows);
  const rows: ImportRowDTO[] = checked.map((row) => ({ line: row.line, name: row.name, values: row.values, errors: row.errors, warnings: row.warnings }));
  const pay = file.ignoredColumns.filter((column) => PAY_HEADINGS.includes(key(column)));
  const validCount = checked.filter((row) => row.errors.length === 0).length;
  const created = await prisma.employeeImportBatch.create({
    data: {
      companyId: context.companyId,
      fileName: input.fileName.slice(0, 200),
      rowCount: rows.length,
      validCount,
      errorCount: rows.length - validCount,
      warningCount: rows.filter((row) => row.warnings.length > 0).length,
      // Pay is never taken from an import (§95): a pay column is named and set aside.
      includesPay: pay.length > 0,
      rows: { ignoredColumns: file.ignoredColumns, rows } as unknown as Prisma.InputJsonValue,
      createdByUserId: context.userId,
    },
    select: BATCH_SELECT,
  });
  return toBatchDTO(created);
}

export async function getImportBatch(context: UserContext, batchId: string): Promise<ImportBatchDTO> {
  assertImporter(context);
  const row = await prisma.employeeImportBatch.findFirst({ where: { id: batchId, companyId: context.companyId }, select: BATCH_SELECT });
  if (!row) throw new AccessError("NOT_FOUND");
  return toBatchDTO(row);
}

/**
 * Makes every row that is still good, each in its own transaction — a bad row
 * never undoes the others, and nothing runs twice: the batch is claimed before
 * the first row is written (§97, §224).
 */
export async function commitImport(context: UserContext, batchId: string): Promise<ImportResultDTO> {
  assertImporter(context);
  const batch = await prisma.employeeImportBatch.findFirst({ where: { id: batchId, companyId: context.companyId }, select: { id: true, fileName: true, status: true, rowCount: true, rows: true } });
  if (!batch) throw new AccessError("NOT_FOUND");
  if (batch.status !== "PREVIEWED") throw stateDenied(batch.status === "COMMITTED" ? "This file has already been imported." : "This file was set aside. Upload it again.");
  const claimed = await prisma.employeeImportBatch.updateMany({
    where: { id: batch.id, companyId: context.companyId, status: "PREVIEWED" },
    data: { status: "COMMITTED", committedAt: new Date(), committedByUserId: context.userId },
  });
  if (claimed.count === 0) throw stateDenied("This file has already been imported.");

  // Checked again: codes taken, trades retired or projects archived since the preview.
  const stored = (batch.rows as unknown as StoredRows).rows;
  const checked = await check(context, stored.map((row) => ({ line: row.line, values: row.values })));
  const result: ImportResultDTO = { batchId: batch.id, createdCount: 0, assignedCount: 0, crewedCount: 0, failed: [] };
  for (const row of checked) if (!row.resolved) result.failed.push({ line: row.line, name: row.name, message: row.errors[0] ?? "The row is no longer valid." });

  const good = checked.filter((row): row is typeof row & { resolved: Resolved } => row.resolved !== null);
  for (let index = 0; index < good.length; index += PARALLEL) {
    await Promise.all(
      good.slice(index, index + PARALLEL).map(async (row) => {
        try {
          const placed = await prisma.$transaction(async (tx) => {
            const made = await createImportedEmployment(tx, context, { ...row.resolved, workPhone: row.resolved.phone }, batch.id);
            const start = dbDay(row.resolved.startDate);
            let assigned = 0;
            let crewed = 0;
            if (row.resolved.projectId) {
              await tx.employeeProjectAssignment.create({
                data: { companyId: context.companyId, employeeProfileId: made.employmentId, projectId: row.resolved.projectId, siteId: row.resolved.siteId, tradeId: row.resolved.tradeId, isPrimary: true, startDate: start, createdByUserId: context.userId },
              });
              assigned = 1;
            }
            if (row.resolved.crewId) {
              await tx.workforceCrewMember.create({ data: { companyId: context.companyId, crewId: row.resolved.crewId, employeeProfileId: made.employmentId, startDate: start, createdByUserId: context.userId } });
              crewed = 1;
            }
            return { assigned, crewed };
          });
          result.createdCount += 1;
          result.assignedCount += placed.assigned;
          result.crewedCount += placed.crewed;
        } catch (error) {
          const message = error instanceof AccessError ? error.message : (error as { code?: string } | null)?.code === "P2002" ? "The employee code was taken while importing." : "The row could not be saved.";
          result.failed.push({ line: row.line, name: row.name, message });
        }
      }),
    );
  }
  result.failed.sort((a, b) => a.line - b.line);

  await prisma.$transaction(async (tx) => {
    await tx.employeeImportBatch.updateMany({ where: { id: batch.id, companyId: context.companyId, status: "COMMITTED" }, data: { createdCount: result.createdCount } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.WORKFORCE_IMPORT_COMMITTED,
        entity: { type: "EmployeeImportBatch", id: batch.id, label: batch.fileName },
        after: { fileName: batch.fileName, rowCount: batch.rowCount, createdCount: result.createdCount, failedCount: result.failed.length, assignedCount: result.assignedCount, crewedCount: result.crewedCount },
        metadata: { failedLines: result.failed.map((row) => row.line).slice(0, 500) },
      },
      { tx },
    );
  });
  return result;
}

export async function discardImport(context: UserContext, batchId: string): Promise<void> {
  assertImporter(context);
  const discarded = await prisma.employeeImportBatch.updateMany({ where: { id: batchId, companyId: context.companyId, status: "PREVIEWED" }, data: { status: "DISCARDED" } });
  if (discarded.count === 0) throw stateDenied("Only a file that has not been imported can be set aside.");
}
