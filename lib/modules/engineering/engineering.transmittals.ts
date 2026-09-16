import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { loadEngineeringProject } from "./engineering.documents";
import { notifyEngineering } from "./engineering.notify";
import { engineeringOpen, filesOpen, MODULE, readableEngineeringDocumentWhere, readableTransmittalWhere, TRANSMITTAL_ACTIVITY, TRANSMITTAL_RECORD } from "./engineering.permissions";
import type { CreateTransmittalInput, TransmittalListQuery, UpdateTransmittalInput } from "./engineering.schema";
import { companyToday } from "./engineering.settings";
import { assertProjectWritable, at, dateOf, fail, people, personOf, projectArchived, projectNumber, resolveProjectContext, withNumber } from "./engineering.shared";
import { documentTransmittalMachine } from "./engineering.transmittal.machine";
import { TRANSMITTAL_PURPOSE_LABELS, type TransmittalDetailDTO, type TransmittalItemDTO, type TransmittalRowDTO } from "./engineering.types";

/**
 * Transmittals (PRD #46 §118-§124, §221, §228, §292).
 *
 *   DRAFT → ISSUED → VOID
 *
 * A draft collects documents; issuing fixes it: the items, and the exact file
 * version each carried, never change afterwards — and those files can no
 * longer take new versions (§123). A mistake is voided and reissued as a new
 * transmittal. Nothing leaves the company: V0.1 records the issue, it does not
 * send it (§5, §132).
 */

const TRANSMITTAL_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  transmittalNumber: true,
  subject: true,
  direction: true,
  purpose: true,
  status: true,
  contractorId: true,
  workPackageId: true,
  senderText: true,
  recipientText: true,
  notes: true,
  issuedAt: true,
  issuedByMemberId: true,
  voidReason: true,
  createdByMemberId: true,
  project: { select: { id: true, name: true, archivedAt: true, status: true, projectManagerMemberId: true } },
  contractor: { select: { id: true, legalName: true } },
  workPackage: { select: { id: true, code: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.DocumentTransmittalSelect;

type TransmittalRow = Prisma.DocumentTransmittalGetPayload<{ select: typeof TRANSMITTAL_SELECT }>;

function toRow(row: TransmittalRow): TransmittalRowDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    transmittalNumber: row.transmittalNumber,
    subject: row.subject,
    direction: row.direction,
    purpose: row.purpose,
    status: row.status,
    contractor: row.contractor ? { id: row.contractor.id, label: row.contractor.legalName, href: `/contractors/${row.contractor.id}` } : null,
    workPackage: row.workPackage ? { id: row.workPackage.id, label: `${row.workPackage.code} · ${row.workPackage.name}`, href: `/projects/${row.projectId}/work-packages/${row.workPackage.id}` } : null,
    recipientText: row.recipientText,
    issuedAt: dateOf(row.issuedAt),
    itemCount: row._count.items,
    href: `/projects/${row.projectId}/engineering/transmittals/${row.id}`,
  };
}

export async function listTransmittals(context: UserContext, query: TransmittalListQuery): Promise<{ items: TransmittalRowDTO[]; total: number; page: number; pageSize: number }> {
  assertModule(context, MODULE);
  if (!engineeringOpen(context, "transmittal.view")) throw new AccessError("FORBIDDEN", "You cannot open transmittals.");
  if (query.projectId) await loadEngineeringProject(context, query.projectId, "transmittal.view");
  const pageSize = 50;
  const filters: Prisma.DocumentTransmittalWhereInput[] = [readableTransmittalWhere(context)];
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.status) filters.push({ status: query.status });
  if (query.direction) filters.push({ direction: query.direction });
  if (query.contractorId) filters.push({ contractorId: query.contractorId });
  if (query.q) {
    // Number, contractor, recipient, or a document number it carried (§124).
    filters.push({
      OR: [
        { transmittalNumber: { contains: query.q, mode: "insensitive" } },
        { subject: { contains: query.q, mode: "insensitive" } },
        { recipientText: { contains: query.q, mode: "insensitive" } },
        { contractor: { legalName: { contains: query.q, mode: "insensitive" } } },
        { items: { some: { engineeringDocument: { documentNumber: { contains: query.q, mode: "insensitive" } } } } },
      ],
    });
  }
  const where = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.documentTransmittal.findMany({ where, orderBy: [{ issuedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], skip: (query.page - 1) * pageSize, take: pageSize, select: TRANSMITTAL_SELECT }),
    prisma.documentTransmittal.count({ where }),
  ]);
  return { items: rows.map(toRow), total, page: query.page, pageSize };
}

async function findReadableTransmittal(context: UserContext, id: string): Promise<TransmittalRow> {
  assertModule(context, MODULE);
  const row = await prisma.documentTransmittal.findFirst({ where: { AND: [readableTransmittalWhere(context), { id }] }, select: TRANSMITTAL_SELECT });
  if (!row) throw fail("TRANSMITTAL_NOT_FOUND", "That transmittal could not be found.", "NOT_FOUND");
  return row;
}

export async function getTransmittal(context: UserContext, id: string): Promise<TransmittalDetailDTO> {
  const row = await findReadableTransmittal(context, id);
  const items = await prisma.documentTransmittalItem.findMany({
    where: { transmittalId: row.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, documentId: true, documentVersionId: true, remarks: true, engineeringDocumentId: true, document: { select: { id: true, name: true, latestVersionNumber: true } }, engineeringDocument: { select: { id: true, projectId: true, documentNumber: true, title: true } }, engineeringRevision: { select: { revisionCode: true } } },
  });
  const [names, versions] = await Promise.all([
    people(context.companyId, [row.issuedByMemberId]),
    prisma.documentVersion.findMany({ where: { id: { in: items.map((item) => item.documentVersionId).filter((value): value is string => Boolean(value)) } }, select: { id: true, versionNumber: true } }),
  ]);
  const versionById = new Map(versions.map((version) => [version.id, version.versionNumber]));
  const files = filesOpen(context);
  const readableDocs = new Set(
    engineeringOpen(context, "engineering_document.view")
      ? (await prisma.engineeringDocument.findMany({ where: { AND: [readableEngineeringDocumentWhere(context), { id: { in: items.map((item) => item.engineeringDocumentId).filter((value): value is string => Boolean(value)) } }] }, select: { id: true } })).map((doc) => doc.id)
      : [],
  );
  /*
   * A file's name is shown only to a reader who could open that file
   * (PRD #46 §249, §253, PRD #47 §62): `document.view` alone is not enough.
   * A file listed under a register entry is read through that entry's door; a
   * loose file through its own parent, as the Documents module decides.
   */
  const looseFiles = files ? items.filter((item) => !item.engineeringDocumentId).map((item) => item.documentId) : [];
  const readableLooseFiles = new Set(looseFiles.length ? await recordDefinition("document")!.reachable(context, looseFiles) : []);
  const fileVisible = (item: (typeof items)[number]) => files && (item.engineeringDocumentId ? readableDocs.has(item.engineeringDocumentId) : readableLooseFiles.has(item.documentId));
  const live = !projectArchived(row.project);
  return {
    ...toRow(row),
    senderText: row.senderText,
    notes: row.notes,
    issuedBy: personOf(names, row.issuedByMemberId),
    voidReason: row.voidReason,
    items: items.map((item): TransmittalItemDTO => ({
      id: item.id,
      document: fileVisible(item) ? { id: item.document.id, name: item.document.name, href: `/documents/${item.document.id}` } : null,
      engineeringDocument: item.engineeringDocument && readableDocs.has(item.engineeringDocument.id) ? { id: item.engineeringDocument.id, label: `${item.engineeringDocument.documentNumber} · ${item.engineeringDocument.title}`, href: `/projects/${item.engineeringDocument.projectId}/engineering/documents/${item.engineeringDocument.id}` } : null,
      revisionCode: item.engineeringDocumentId && !readableDocs.has(item.engineeringDocumentId) ? null : (item.engineeringRevision?.revisionCode ?? null),
      versionNumber: item.documentVersionId ? (versionById.get(item.documentVersionId) ?? null) : item.document.latestVersionNumber || null,
      remarks: item.remarks,
    })),
    capabilities: {
      canEditDraft: live && row.status === "DRAFT" && can(context, "transmittal.create"),
      canIssue: live && row.status === "DRAFT" && can(context, "transmittal.issue") && row._count.items > 0,
      canVoid: live && row.status !== "VOID" && can(context, "transmittal.void"),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

type ItemInput = CreateTransmittalInput["items"][number];

/** Every item is a file on this project the writer can open; a register entry and revision must match it (§122, §224, §305). */
async function resolveItems(context: UserContext, projectId: string, items: ItemInput[]) {
  const seen = new Set<string>();
  const resolved: Array<ItemInput & { sortOrder: number }> = [];
  for (const [index, item] of items.entries()) {
    if (seen.has(item.documentId)) throw fail("TRANSMITTAL_ITEM_DUPLICATE", "A document appears on the transmittal twice.", "VALIDATION_ERROR", { field: `items.${index}` });
    seen.add(item.documentId);
    if (item.engineeringDocumentId) {
      const doc = await prisma.engineeringDocument.findFirst({ where: { AND: [readableEngineeringDocumentWhere(context), { id: item.engineeringDocumentId }] }, select: { id: true, projectId: true, status: true } });
      if (!doc) throw fail("TRANSMITTAL_ITEM_INVALID", "One of the documents could not be found.", "VALIDATION_ERROR", { field: `items.${index}` });
      if (doc.projectId !== projectId) throw fail("TRANSMITTAL_ITEM_PROJECT_MISMATCH", "One of the documents belongs to another project.", "VALIDATION_ERROR", { field: `items.${index}` });
      if (item.engineeringRevisionId) {
        const revision = await prisma.engineeringDocumentRevision.findFirst({ where: { id: item.engineeringRevisionId, engineeringDocumentId: doc.id, status: { not: "VOID" } }, select: { documentId: true, status: true } });
        if (!revision || revision.documentId !== item.documentId) throw fail("TRANSMITTAL_ITEM_REVISION_MISMATCH", "That revision does not carry that file.", "VALIDATION_ERROR", { field: `items.${index}` });
        if (revision.status === "DRAFT") throw fail("TRANSMITTAL_ITEM_DRAFT", "A draft revision is not issued; submit it first.", "VALIDATION_ERROR", { field: `items.${index}` });
      } else {
        const onRecord = await prisma.document.count({ where: { id: item.documentId, companyId: context.companyId, entityType: "engineering_document", entityId: doc.id, status: "ACTIVE" } });
        if (!onRecord) throw fail("TRANSMITTAL_ITEM_INVALID", "That file is not on the document it is listed under.", "VALIDATION_ERROR", { field: `items.${index}` });
      }
    } else {
      if (item.engineeringRevisionId) throw fail("TRANSMITTAL_ITEM_INVALID", "Name the document the revision belongs to.", "VALIDATION_ERROR", { field: `items.${index}` });
      const document = await loadRecord(context, "document", item.documentId);
      if (!document || document.companyId !== context.companyId) throw fail("TRANSMITTAL_ITEM_INVALID", "One of the documents could not be found.", "VALIDATION_ERROR", { field: `items.${index}` });
      if (document.projectId !== projectId) throw fail("TRANSMITTAL_ITEM_PROJECT_MISMATCH", "One of the documents belongs to another project.", "VALIDATION_ERROR", { field: `items.${index}` });
    }
    resolved.push({ ...item, sortOrder: index });
  }
  return resolved;
}

export async function createTransmittal(context: UserContext, projectId: string, input: CreateTransmittalInput): Promise<{ id: string; transmittalNumber: string }> {
  const project = await loadEngineeringProject(context, projectId, "transmittal.view");
  assertPermission(context, "transmittal.create");
  assertProjectWritable(project);
  const [scope, items] = await Promise.all([resolveProjectContext(context, project.id, input, { newWork: true }), resolveItems(context, project.id, input.items)]);
  return withNumber("transmittalNumber", input.transmittalNumber, { code: "TRANSMITTAL_NUMBER_TAKEN", message: "That transmittal number is already used on this project." }, () =>
    prisma.$transaction(async (tx) => {
      const transmittalNumber = await projectNumber(tx, {
        companyId: context.companyId,
        moduleKey: MODULE,
        entityType: TRANSMITTAL_RECORD,
        prefix: "TRN",
        manual: input.transmittalNumber,
        count: () => tx.documentTransmittal.count({ where: { companyId: context.companyId, projectId: project.id } }),
        taken: async (candidate) => (await tx.documentTransmittal.count({ where: { companyId: context.companyId, projectId: project.id, transmittalNumber: candidate } })) > 0,
      });
      const row = await tx.documentTransmittal.create({
        data: {
          companyId: context.companyId, projectId: project.id, transmittalNumber, direction: input.direction, purpose: input.purpose, subject: input.subject,
          contractorId: scope.contractorId, workPackageId: scope.workPackageId, senderText: input.senderText, recipientText: input.recipientText, notes: input.notes,
          createdByMemberId: context.membershipId,
          items: { create: items.map((item) => ({ companyId: context.companyId, documentId: item.documentId, engineeringDocumentId: item.engineeringDocumentId, engineeringRevisionId: item.engineeringRevisionId, remarks: item.remarks, sortOrder: item.sortOrder })) },
        },
        select: { id: true, transmittalNumber: true },
      });
      await recordUserAction(context, { actionKey: AuditAction.TRANSMITTAL_CREATED, entity: { type: TRANSMITTAL_RECORD, id: row.id, label: transmittalNumber }, projectId: project.id, after: { transmittalNumber, direction: input.direction, purpose: input.purpose, contractorId: scope.contractorId, workPackageId: scope.workPackageId, items: items.length } }, { tx });
      await recordActivity(tx, context, { module: MODULE, entityType: TRANSMITTAL_ACTIVITY, entityId: row.id, action: "TRANSMITTAL_CREATED", message: `prepared transmittal ${transmittalNumber}` });
      return row;
    }),
  );
}

async function findDraft(context: UserContext, id: string, permission: "transmittal.create" | "transmittal.issue") {
  const row = await findReadableTransmittal(context, id);
  assertPermission(context, permission);
  assertProjectWritable(row.project);
  // Issued contents never change: a correction is a void and a new transmittal (§123).
  if (row.status !== "DRAFT") throw fail("TRANSMITTAL_ISSUED_LOCKED", "An issued transmittal cannot be changed. Void it and issue a new one.", "CONFLICT");
  return row;
}

export async function updateTransmittal(context: UserContext, id: string, input: UpdateTransmittalInput): Promise<{ id: string }> {
  const row = await findDraft(context, id, "transmittal.create");
  const [scope, items] = await Promise.all([
    resolveProjectContext(context, row.projectId, input, { newWork: input.contractorId !== row.contractorId || input.workPackageId !== row.workPackageId }),
    resolveItems(context, row.projectId, input.items),
  ]);
  await prisma.$transaction(async (tx) => {
    const moved = await tx.documentTransmittal.updateMany({ where: { id: row.id, status: "DRAFT" }, data: { direction: input.direction, purpose: input.purpose, subject: input.subject, contractorId: scope.contractorId, workPackageId: scope.workPackageId, senderText: input.senderText, recipientText: input.recipientText, notes: input.notes } });
    if (!moved.count) throw fail("TRANSMITTAL_ISSUED_LOCKED", "An issued transmittal cannot be changed. Void it and issue a new one.", "CONFLICT");
    await tx.documentTransmittalItem.deleteMany({ where: { transmittalId: row.id } });
    if (items.length) await tx.documentTransmittalItem.createMany({ data: items.map((item) => ({ companyId: context.companyId, transmittalId: row.id, documentId: item.documentId, engineeringDocumentId: item.engineeringDocumentId, engineeringRevisionId: item.engineeringRevisionId, remarks: item.remarks, sortOrder: item.sortOrder })) });
    await recordUserAction(context, { actionKey: AuditAction.TRANSMITTAL_UPDATED, entity: { type: TRANSMITTAL_RECORD, id: row.id, label: row.transmittalNumber }, projectId: row.projectId, after: { direction: input.direction, purpose: input.purpose, contractorId: scope.contractorId, workPackageId: scope.workPackageId, items: items.length } }, { tx });
  });
  return { id: row.id };
}

export async function issueTransmittal(context: UserContext, id: string, input: { issuedAt: string | null }): Promise<{ id: string }> {
  const row = await findDraft(context, id, "transmittal.issue");
  const items = await prisma.documentTransmittalItem.findMany({ where: { transmittalId: row.id }, select: { id: true, documentId: true, engineeringDocument: { select: { responsibleMemberId: true } }, engineeringRevision: { select: { documentVersionId: true } }, document: { select: { currentVersionId: true, storageStatus: true, status: true } } } });
  if (!items.length) throw fail("TRANSMITTAL_EMPTY", "Add at least one document before issuing.", "CONFLICT");
  if (items.some((item) => item.document.status !== "ACTIVE" || item.document.storageStatus !== "AVAILABLE")) throw fail("TRANSMITTAL_FILE_NOT_READY", "One of the files is still being processed or is no longer available.", "CONFLICT");
  const { today } = await companyToday(context.companyId);
  const issuedDate = input.issuedAt ?? today;
  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, { machine: documentTransmittalMachine, action: "issue", id: row.id, context, from: row.status, data: { issuedAt: at(issuedDate), issuedByMemberId: context.membershipId } });
    /*
     * The version each file carried at issue, for good (§122, §123). An item
     * that names a revision carries the version that revision was submitted
     * with — not whatever the file holds now, which a late upload could have
     * moved (PRD #47 §87). Only a revision that pinned no version (older
     * records) falls back to the file's current one.
     */
    for (const item of items) {
      const documentVersionId = item.engineeringRevision?.documentVersionId ?? item.document.currentVersionId;
      await tx.documentTransmittalItem.update({ where: { id: item.id }, data: { documentVersionId } });
    }
    await recordUserAction(context, { actionKey: AuditAction.TRANSMITTAL_ISSUED, entity: { type: TRANSMITTAL_RECORD, id: row.id, label: row.transmittalNumber }, projectId: row.projectId, before: { status: "DRAFT" }, after: { status: "ISSUED", issuedAt: issuedDate, items: items.length } }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: TRANSMITTAL_ACTIVITY, entityId: row.id, action: "TRANSMITTAL_ISSUED", message: `issued transmittal ${row.transmittalNumber}` });
    await notifyEngineering(tx, {
      companyId: context.companyId, eventType: NotificationEvent.TRANSMITTAL_ISSUED, entityType: TRANSMITTAL_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: context.membershipId,
      memberIds: [row.project.projectManagerMemberId, row.createdByMemberId, ...items.map((item) => item.engineeringDocument?.responsibleMemberId)],
      payload: { number: row.transmittalNumber, purposeLabel: TRANSMITTAL_PURPOSE_LABELS[row.purpose], count: items.length },
    });
  });
  return { id: row.id };
}

export async function voidTransmittal(context: UserContext, id: string, input: { reason: string }): Promise<{ id: string }> {
  const row = await findReadableTransmittal(context, id);
  assertPermission(context, "transmittal.void");
  assertProjectWritable(row.project);
  if (row.status === "VOID") throw fail("TRANSMITTAL_VOID", "This transmittal is already void.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, { machine: documentTransmittalMachine, action: "void", id: row.id, context, from: row.status, reason: input.reason, data: { voidedAt: new Date(), voidReason: input.reason, voidedByMemberId: context.membershipId } });
    await recordUserAction(context, { actionKey: AuditAction.TRANSMITTAL_VOIDED, entity: { type: TRANSMITTAL_RECORD, id: row.id, label: row.transmittalNumber }, projectId: row.projectId, before: { status: row.status }, after: { status: "VOID" }, reason: input.reason }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: TRANSMITTAL_ACTIVITY, entityId: row.id, action: "TRANSMITTAL_VOIDED", message: `voided transmittal ${row.transmittalNumber}` });
  });
  return { id: row.id };
}

export type TransmittalDocumentOption = { engineeringDocumentId: string; label: string; revisions: Array<{ id: string; code: string; status: string; documentId: string; fileName: string }> };

/** Register documents on the project with the revisions that could travel, newest first (§119, §122). */
export async function transmittalDocumentOptions(context: UserContext, projectId: string): Promise<TransmittalDocumentOption[]> {
  const project = await loadEngineeringProject(context, projectId, "transmittal.view");
  if (!engineeringOpen(context, "engineering_document.view") || !filesOpen(context)) return [];
  const docs = await prisma.engineeringDocument.findMany({
    where: { AND: [readableEngineeringDocumentWhere(context), { projectId: project.id, status: { not: "VOID" } }] },
    orderBy: { documentNumber: "asc" },
    take: 300,
    select: { id: true, documentNumber: true, title: true, revisions: { where: { status: { notIn: ["DRAFT", "VOID"] } }, orderBy: { revisionNumber: "desc" }, select: { id: true, revisionCode: true, status: true, documentId: true, document: { select: { name: true } } } } },
  });
  return docs
    .filter((doc) => doc.revisions.length)
    .map((doc) => ({ engineeringDocumentId: doc.id, label: `${doc.documentNumber} · ${doc.title}`, revisions: doc.revisions.map((revision) => ({ id: revision.id, code: revision.revisionCode, status: revision.status, documentId: revision.documentId, fileName: revision.document.name })) }));
}
