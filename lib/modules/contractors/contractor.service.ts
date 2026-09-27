import type { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { engineeringOpen, filesOpen, filesWritable, readableRfiWhere, readableSubmittalWhere } from "@/lib/modules/engineering/engineering.permissions";
import { kept } from "@/lib/modules/engineering/engineering.fields";
import { fail, LIST_SNAPSHOT } from "@/lib/modules/engineering/engineering.shared";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import type { Option } from "@/lib/modules/engineering/engineering.types";
import { RFI_OPEN_STATUSES } from "@/lib/modules/engineering/engineering.types";
import { recordActivity } from "@/lib/modules/shared/activity";
import { normalizeContractorName } from "./contractor.names";
import {
  ACTIVITY_ENTITY,
  commercialOpen,
  contractorDirectoryWhere,
  contractorsOpen,
  MODULE,
  RECORD,
  readableAssignmentWhere,
  readableComplianceWhere,
  readableWorkPackageWhere,
} from "./contractor.permissions";
import type { ContractorListQuery, CreateContractorInput, UpdateContractorInput } from "./contractor.schema";
import {
  COMPLIANCE_ALERT_STATUSES,
  CONTRACTOR_STATUS_LABELS,
  OPEN_WORK_PACKAGE_STATUSES,
  type ContractorCapabilities,
  type ContractorDetailDTO,
  type ContractorListItemDTO,
  type ContractorStatus,
  type DuplicateWarning,
} from "./contractor.types";

/**
 * The contractor directory (PRD #46 §11-§19, §160-§164, §212, §284).
 *
 * A contractor is an external organisation: it has contacts, never logins, and
 * it is not a Supplier — when it also sells through Procurement the Supplier is
 * linked, never copied (§14, §15). Duplicates are warned about, not merged
 * (§16); a contractor with history is archived, never deleted (§18), and
 * brought back only by somebody allowed to, with a reason (§19).
 */

type Tx = Prisma.TransactionClient;

const SUBMITTAL_OPEN = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUIRED"] as const;
const CLOSED_FOR_EDIT: ContractorStatus[] = ["OFFBOARDED", "ARCHIVED"];
/** Mailbox providers say nothing about which company a person works for. */
const PUBLIC_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "proton.me", "protonmail.com", "aol.com", "gmx.com"]);

export const CONTRACTOR_SELECT = {
  id: true,
  companyId: true,
  legalName: true,
  tradingName: true,
  registrationNumber: true,
  vatNumber: true,
  email: true,
  phone: true,
  website: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  countryCode: true,
  status: true,
  statusChangedAt: true,
  statusReason: true,
  supplierId: true,
  primaryContactName: true,
  primaryContactEmail: true,
  primaryContactPhone: true,
  notes: true,
  createdByMemberId: true,
  archivedAt: true,
  version: true,
  createdAt: true,
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ContractorProfileSelect;

export type ContractorRow = Prisma.ContractorProfileGetPayload<{ select: typeof CONTRACTOR_SELECT }>;

function domainOf(email: string | null | undefined): string | null {
  const domain = email?.split("@")[1]?.toLowerCase();
  return domain && !PUBLIC_DOMAINS.has(domain) ? domain : null;
}

export async function findReadableContractor(context: UserContext, id: string): Promise<ContractorRow> {
  assertModule(context, MODULE);
  if (!contractorsOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open contractors.");
  const row = await prisma.contractorProfile.findFirst({ where: { AND: [contractorDirectoryWhere(context), { id }] }, select: CONTRACTOR_SELECT });
  if (!row) throw fail("CONTRACTOR_NOT_FOUND", "That contractor could not be found.", "NOT_FOUND");
  return row;
}

function assertEditable(row: Pick<ContractorRow, "status">) {
  if (CLOSED_FOR_EDIT.includes(row.status)) throw fail("CONTRACTOR_READ_ONLY", "Reactivate this contractor before changing it.", "CONFLICT");
}

export function contractorCapabilities(context: UserContext, row: Pick<ContractorRow, "status">): ContractorCapabilities {
  const open = contractorsOpen(context);
  const has = (permission: Parameters<typeof can>[1]) => open && can(context, permission);
  const closed = CLOSED_FOR_EDIT.includes(row.status);
  return {
    canEdit: has("contractor.edit") && !closed,
    canArchive: has("contractor.archive") && row.status !== "ARCHIVED",
    canOffboard: has("contractor.archive") && !closed,
    canReactivate: has("contractor.archive") && closed,
    canManageContacts: has("contractor_contact.manage") && !closed,
    canAssign: has("project_contractor.manage") && can(context, "project.view") && !["SUSPENDED", ...CLOSED_FOR_EDIT].includes(row.status),
    canManageCompliance: has("contractor_compliance.manage") && row.status !== "ARCHIVED",
    canWaiveCompliance: has("contractor_compliance.waive") && row.status !== "ARCHIVED",
    canViewCompliance: has("contractor_compliance.view"),
    canViewContacts: has("contractor_contact.view"),
    canViewWorkPackages: has("work_package.view"),
    canViewEngineering: engineeringOpen(context),
    canViewContracts: commercialOpen(context) && canAccessModule(context, "contracts"),
    canViewDocuments: filesOpen(context),
    canUploadDocuments: filesWritable(context) && has("contractor.edit") && row.status !== "ARCHIVED",
    canViewActivity: open,
  };
}

/* -------------------------------------------------------------------------- */
/* Counts                                                                      */
/* -------------------------------------------------------------------------- */

type Counts = Pick<ContractorListItemDTO, "activeProjects" | "workPackages" | "openRfis" | "openSubmittals" | "complianceAlerts">;

/** Everything a list row counts, in five grouped queries, each inside the reader's own doors (§238). */
export async function contractorCounts(context: UserContext, ids: string[]): Promise<Map<string, Counts>> {
  const result = new Map<string, Counts>(ids.map((id) => [id, { activeProjects: 0, workPackages: 0, openRfis: 0, openSubmittals: 0, complianceAlerts: 0 }]));
  if (!ids.length) return result;
  const [assignments, packages, rfis, submittals, compliance] = await Promise.all([
    prisma.projectContractorAssignment.groupBy({ by: ["contractorId"], where: { AND: [readableAssignmentWhere(context), { contractorId: { in: ids }, status: "ACTIVE" }] }, _count: { _all: true } }),
    prisma.workPackage.groupBy({ by: ["contractorId"], where: { AND: [readableWorkPackageWhere(context), { contractorId: { in: ids }, archivedAt: null, status: { in: OPEN_WORK_PACKAGE_STATUSES } }] }, _count: { _all: true } }),
    engineeringOpen(context, "rfi.view") ? prisma.rfi.groupBy({ by: ["contractorId"], where: { AND: [readableRfiWhere(context), { contractorId: { in: ids }, status: { in: RFI_OPEN_STATUSES } }] }, _count: { _all: true } }) : [],
    engineeringOpen(context, "submittal.view") ? prisma.technicalSubmittal.groupBy({ by: ["contractorId"], where: { AND: [readableSubmittalWhere(context), { contractorId: { in: ids }, status: { in: [...SUBMITTAL_OPEN] } }] }, _count: { _all: true } }) : [],
    prisma.contractorComplianceItem.groupBy({ by: ["contractorId"], where: { AND: [readableComplianceWhere(context), { contractorId: { in: ids }, archivedAt: null, status: { in: COMPLIANCE_ALERT_STATUSES } }] }, _count: { _all: true } }),
  ]);
  const add = (rows: Array<{ contractorId: string | null; _count: { _all: number } }>, key: keyof Counts) => {
    for (const row of rows) if (row.contractorId && result.has(row.contractorId)) result.get(row.contractorId)![key] = row._count._all;
  };
  add(assignments, "activeProjects");
  add(packages, "workPackages");
  add(rfis, "openRfis");
  add(submittals, "openSubmittals");
  add(compliance, "complianceAlerts");
  return result;
}

function toListItem(row: ContractorRow, counts: Counts | undefined, context: UserContext): ContractorListItemDTO {
  const supplierVisible = row.supplier && canAccessModule(context, "procurement") && can(context, "procurement.supplier.view");
  return {
    id: row.id,
    legalName: row.legalName,
    tradingName: row.tradingName,
    status: row.status,
    countryCode: row.countryCode,
    city: row.city,
    supplier: supplierVisible ? { id: row.supplier!.id, label: row.supplier!.name, href: `/procurement/suppliers/${row.supplier!.id}` } : null,
    primaryContactName: row.primaryContactName,
    activeProjects: counts?.activeProjects ?? 0,
    workPackages: counts?.workPackages ?? 0,
    openRfis: counts?.openRfis ?? 0,
    openSubmittals: counts?.openSubmittals ?? 0,
    complianceAlerts: counts?.complianceAlerts ?? 0,
    href: `/contractors/${row.id}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listContractors(context: UserContext, query: ContractorListQuery): Promise<{ items: ContractorListItemDTO[]; total: number; page: number; pageSize: number }> {
  assertModule(context, MODULE);
  if (!contractorsOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open contractors.");
  const filters: Prisma.ContractorProfileWhereInput[] = [contractorDirectoryWhere(context)];
  if (query.status) filters.push({ status: query.status });
  else if (!query.includeArchived) filters.push({ status: { not: "ARCHIVED" } });
  if (query.q) {
    filters.push({
      OR: [
        { legalName: { contains: query.q, mode: "insensitive" } },
        { tradingName: { contains: query.q, mode: "insensitive" } },
        { registrationNumber: { contains: query.q, mode: "insensitive" } },
        { vatNumber: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  if (query.compliance === "alerts") filters.push({ complianceItems: { some: { archivedAt: null, status: { in: COMPLIANCE_ALERT_STATUSES } } } });
  if (query.projectId) filters.push({ projectAssignments: { some: { AND: [readableAssignmentWhere(context), { projectId: query.projectId }] } } });
  const where = { AND: filters };
  // Legal name, then the id: two contractors with one name keep one order on every page (AUD-08 §4, DT-04).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.contractorProfile.findMany({ where, orderBy: [{ legalName: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: CONTRACTOR_SELECT }),
      prisma.contractorProfile.count({ where }),
    ],
    LIST_SNAPSHOT,
  );
  const counts = await contractorCounts(context, rows.map((row) => row.id));
  return { items: rows.map((row) => toListItem(row, counts.get(row.id), context)), total, page: paginationMeta(total, query.page, query.pageSize).page, pageSize: query.pageSize };
}

export async function getContractor(context: UserContext, id: string): Promise<ContractorDetailDTO> {
  const row = await findReadableContractor(context, id);
  const counts = await contractorCounts(context, [row.id]);
  return {
    ...toListItem(row, counts.get(row.id), context),
    registrationNumber: row.registrationNumber,
    vatNumber: row.vatNumber,
    email: row.email,
    phone: row.phone,
    website: row.website,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    region: row.region,
    postalCode: row.postalCode,
    primaryContactEmail: row.primaryContactEmail,
    primaryContactPhone: row.primaryContactPhone,
    notes: row.notes,
    statusReason: row.statusReason,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    capabilities: contractorCapabilities(context, row),
  };
}

/* -------------------------------------------------------------------------- */
/* Duplicates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Contractors that look like the one being entered (§16): the same normalised
 * legal name, registration or VAT number, company email domain, or Supplier.
 * Only contractors this writer can read are named; others are reported as
 * "already in the directory" without saying who.
 */
export async function findDuplicateContractors(
  context: UserContext,
  input: { legalName?: string | null; registrationNumber?: string | null; vatNumber?: string | null; email?: string | null; supplierId?: string | null; excludeId?: string | null },
): Promise<DuplicateWarning[]> {
  const normalized = input.legalName ? normalizeContractorName(input.legalName) : "";
  const domain = domainOf(input.email);
  const or: Prisma.ContractorProfileWhereInput[] = [];
  if (normalized) or.push({ normalizedName: normalized });
  if (input.registrationNumber) or.push({ registrationNumber: { equals: input.registrationNumber, mode: "insensitive" } });
  if (input.vatNumber) or.push({ vatNumber: { equals: input.vatNumber, mode: "insensitive" } });
  if (domain) or.push({ email: { endsWith: `@${domain}`, mode: "insensitive" } });
  if (input.supplierId) or.push({ supplierId: input.supplierId });
  if (!or.length) return [];
  const rows = await prisma.contractorProfile.findMany({
    where: { companyId: context.companyId, OR: or, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
    take: 10,
    select: { id: true, legalName: true, status: true, normalizedName: true, registrationNumber: true, vatNumber: true, email: true, supplierId: true },
  });
  if (!rows.length) return [];
  const readable = new Set(
    (await prisma.contractorProfile.findMany({ where: { AND: [contractorDirectoryWhere(context), { id: { in: rows.map((row) => row.id) } }] }, select: { id: true } })).map((row) => row.id),
  );
  return rows.map((row) => {
    const reasons: string[] = [];
    if (normalized && row.normalizedName === normalized) reasons.push("Same legal name");
    if (input.registrationNumber && row.registrationNumber?.toLowerCase() === input.registrationNumber.toLowerCase()) reasons.push("Same registration number");
    if (input.vatNumber && row.vatNumber?.toLowerCase() === input.vatNumber.toLowerCase()) reasons.push("Same VAT number");
    if (domain && domainOf(row.email) === domain) reasons.push("Same email domain");
    if (input.supplierId && row.supplierId === input.supplierId) reasons.push("Linked to the same supplier");
    return readable.has(row.id)
      ? { id: row.id, legalName: row.legalName, status: row.status, reasons }
      : { id: "", legalName: "A contractor already in the directory", status: row.status, reasons };
  });
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** A Supplier is linked only from this company, and only by somebody who can see suppliers (§244). */
async function assertSupplier(context: UserContext, supplierId: string | null, current: string | null = null) {
  if (!supplierId || supplierId === current) return;
  if (!canAccessModule(context, "procurement") || !can(context, "procurement.supplier.view")) throw fail("CONTRACTOR_SUPPLIER_FORBIDDEN", "You cannot link suppliers.", "FORBIDDEN", { field: "supplierId" });
  const supplier = await prisma.supplier.count({ where: { id: supplierId, companyId: context.companyId, archivedAt: null } });
  if (!supplier) throw fail("CONTRACTOR_SUPPLIER_INVALID", "That supplier could not be found.", "VALIDATION_ERROR", { field: "supplierId" });
}

function profileData(input: CreateContractorInput | UpdateContractorInput) {
  return {
    legalName: input.legalName,
    normalizedName: normalizeContractorName(input.legalName),
    tradingName: input.tradingName,
    registrationNumber: input.registrationNumber,
    vatNumber: input.vatNumber,
    email: input.email,
    phone: input.phone,
    website: input.website,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    countryCode: input.countryCode,
    supplierId: input.supplierId,
    primaryContactName: input.primaryContactName,
    primaryContactEmail: input.primaryContactEmail,
    primaryContactPhone: input.primaryContactPhone,
    notes: input.notes,
  };
}

/** The internal people who answer for this contractor's live work, and the projects' managers (§46, §194). */
async function contractorAudience(tx: Tx, companyId: string, contractorId: string): Promise<string[]> {
  const rows = await tx.projectContractorAssignment.findMany({
    where: { companyId, contractorId, status: { notIn: ["TERMINATED", "COMPLETED"] } },
    select: { internalManagerMemberId: true, project: { select: { projectManagerMemberId: true } } },
  });
  return [...new Set(rows.flatMap((row) => [row.internalManagerMemberId, row.project.projectManagerMemberId]).filter((id): id is string => Boolean(id)))];
}

async function notifyStatus(tx: Tx, context: UserContext, row: { id: string; legalName: string }, status: ContractorStatus, reason: string | null) {
  const memberIds = await contractorAudience(tx, context.companyId, row.id);
  if (!memberIds.length) return;
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType: NotificationEvent.CONTRACTOR_STATUS_CHANGED,
    moduleKey: MODULE,
    entityType: RECORD,
    entityId: row.id,
    actorMemberId: context.membershipId,
    projectId: null,
    payload: { memberIds, contractorName: row.legalName, status, statusLabel: CONTRACTOR_STATUS_LABELS[status].toLowerCase(), changedAt: new Date().toISOString(), reason: reason ? "yes" : "" },
  });
}

export async function createContractor(context: UserContext, input: CreateContractorInput): Promise<{ id: string; duplicates: DuplicateWarning[] }> {
  assertModule(context, MODULE);
  assertPermission(context, "contractor.create");
  await assertSupplier(context, input.supplierId);
  const duplicates = await findDuplicateContractors(context, input);
  if (duplicates.length && !input.confirmDuplicate) {
    throw fail("CONTRACTOR_DUPLICATE", "This looks like a contractor already in the directory.", "CONFLICT", { duplicates });
  }
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.contractorProfile.create({
      data: { companyId: context.companyId, ...profileData(input), status: input.status as ContractorStatus, statusChangedAt: new Date(), createdByMemberId: context.membershipId },
      select: { id: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "CONTRACTOR_CREATED", message: `added ${input.legalName} to the contractor directory` });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CONTRACTOR_CREATED,
        entity: { type: RECORD, id: row.id, label: input.legalName },
        after: { legalName: input.legalName, status: input.status, supplierId: input.supplierId, countryCode: input.countryCode, registrationNumber: input.registrationNumber, vatNumber: input.vatNumber, duplicateConfirmed: duplicates.length > 0 },
      },
      { tx },
    );
    return row;
  });
  incrementCounter(Metric.CONTRACTOR_CREATE_SUCCESS);
  return { id: created.id, duplicates };
}

export async function updateContractor(context: UserContext, id: string, input: UpdateContractorInput): Promise<{ id: string; version: number }> {
  const row = await findReadableContractor(context, id);
  assertPermission(context, "contractor.edit");
  assertEditable(row);
  // Absent fields are kept (AUD-09 §4, FV-05): Prisma leaves an undefined field alone.
  await assertSupplier(context, input.supplierId === undefined ? row.supplierId : input.supplierId, row.supplierId);
  const status = (input.status ?? row.status) as ContractorStatus;
  const statusChanged = status !== row.status;
  await prisma.$transaction(async (tx) => {
    const moved = await tx.contractorProfile.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: { notIn: CLOSED_FOR_EDIT } },
      data: { ...profileData(input), status, ...(statusChanged ? { statusChangedAt: new Date(), statusReason: input.statusReason } : {}), updatedByMemberId: context.membershipId, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("CONTRACTOR_STALE", "This contractor changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CONTRACTOR_UPDATED,
        entity: { type: RECORD, id: row.id, label: input.legalName },
        before: { legalName: row.legalName, tradingName: row.tradingName, status: row.status, supplierId: row.supplierId, countryCode: row.countryCode, registrationNumber: row.registrationNumber, vatNumber: row.vatNumber, email: row.email, phone: row.phone },
        after: {
          legalName: input.legalName,
          tradingName: kept(input.tradingName, row.tradingName),
          status,
          supplierId: kept(input.supplierId, row.supplierId),
          countryCode: kept(input.countryCode, row.countryCode),
          registrationNumber: kept(input.registrationNumber, row.registrationNumber),
          vatNumber: kept(input.vatNumber, row.vatNumber),
          email: kept(input.email, row.email),
          phone: kept(input.phone, row.phone),
        },
        reason: statusChanged ? input.statusReason : null,
      },
      { tx },
    );
    if (statusChanged) {
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "CONTRACTOR_STATUS_CHANGED", message: `marked ${input.legalName} ${CONTRACTOR_STATUS_LABELS[status].toLowerCase()}` });
      await notifyStatus(tx, context, { id: row.id, legalName: input.legalName }, status, input.statusReason);
    }
  });
  return { id: row.id, version: input.expectedVersion + 1 };
}

/** Offboarding keeps the history and ends the relationship; archiving puts it away (§13, §18). */
export async function archiveContractor(context: UserContext, id: string, input: { status: "OFFBOARDED" | "ARCHIVED"; reason: string | null; expectedVersion: number }) {
  const row = await findReadableContractor(context, id);
  assertPermission(context, "contractor.archive");
  if (row.status === input.status || row.status === "ARCHIVED") throw fail("CONTRACTOR_ALREADY_CLOSED", `This contractor is already ${CONTRACTOR_STATUS_LABELS[row.status].toLowerCase()}.`, "CONFLICT");
  const live = await prisma.projectContractorAssignment.count({ where: { companyId: context.companyId, contractorId: row.id, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD", "SUSPENDED"] } } });
  if (live) throw fail("CONTRACTOR_HAS_LIVE_ASSIGNMENTS", "Complete or terminate this contractor's project assignments first.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    const moved = await tx.contractorProfile.updateMany({
      where: { id: row.id, version: input.expectedVersion },
      data: { status: input.status, statusChangedAt: new Date(), statusReason: input.reason, archivedAt: input.status === "ARCHIVED" ? new Date() : null, updatedByMemberId: context.membershipId, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("CONTRACTOR_STALE", "This contractor changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "CONTRACTOR_ARCHIVED", message: input.status === "ARCHIVED" ? `archived ${row.legalName}` : `offboarded ${row.legalName}` });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_ARCHIVED, entity: { type: RECORD, id: row.id, label: row.legalName }, before: { status: row.status }, after: { status: input.status }, reason: input.reason }, { tx });
  });
  return { id: row.id, version: input.expectedVersion + 1 };
}

export async function reactivateContractor(context: UserContext, id: string, input: { status: "ACTIVE" | "PROSPECTIVE"; reason: string; expectedVersion: number }) {
  const row = await findReadableContractor(context, id);
  assertPermission(context, "contractor.archive");
  if (!CLOSED_FOR_EDIT.includes(row.status)) throw fail("CONTRACTOR_NOT_CLOSED", "Only an offboarded or archived contractor is reactivated.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    const moved = await tx.contractorProfile.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: { in: CLOSED_FOR_EDIT } },
      data: { status: input.status, statusChangedAt: new Date(), statusReason: input.reason, archivedAt: null, updatedByMemberId: context.membershipId, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("CONTRACTOR_STALE", "This contractor changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "CONTRACTOR_REACTIVATED", message: `reactivated ${row.legalName}` });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_REACTIVATED, entity: { type: RECORD, id: row.id, label: row.legalName }, before: { status: row.status }, after: { status: input.status }, reason: input.reason }, { tx });
  });
  return { id: row.id, version: input.expectedVersion + 1 };
}

/** What the contractor form may offer this writer (§15, §244). */
export async function contractorFormOptions(context: UserContext): Promise<{ suppliers: Option[] }> {
  assertModule(context, MODULE);
  const suppliers =
    canAccessModule(context, "procurement") && can(context, "procurement.supplier.view")
      ? await prisma.supplier.findMany({ where: { companyId: context.companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } })
      : [];
  return { suppliers: suppliers.map((row) => ({ id: row.id, label: row.name })) };
}
