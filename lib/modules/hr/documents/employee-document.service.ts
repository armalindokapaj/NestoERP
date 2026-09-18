import type { CredentialVerificationStatus, EmployeeDocumentCategory, EmployeeDocumentVisibility, Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, invalidRecordLink, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { applyTransition, assertTransitionAllowed } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import { dayOf, dbDay, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { personName, PERSON_NAME_SELECT } from "@/lib/modules/hr/hr.person";
import {
  addableCategories,
  EMPLOYEE_RECORD_TYPE,
  hrManageableClasses,
  hrReachesEmployment,
  readableEmployeeDocumentWhere,
  readableLinkWhere,
  SELF_VISIBLE,
} from "./employee-document.access";
import { employeeDocumentVerificationMachine } from "./employee-document.machine";
import type {
  ArchiveEmployeeDocumentInput,
  FileEmployeeDocumentInput,
  RejectEmployeeDocumentInput,
  ResubmitEmployeeDocumentInput,
  SupersedeEmployeeDocumentInput,
  UpdateEmployeeDocumentInput,
  VerifyEmployeeDocumentInput,
} from "./employee-document.schema";
import {
  CATEGORY_RULES,
  DOCUMENT_GROUPS,
  expiryStateOf,
  type EmployeeDocumentActions,
  type EmployeeDocumentDTO,
  type EmployeeDocumentsDTO,
  type EmployeeDocumentSummaryDTO,
  type UnfiledDocumentDTO,
} from "./employee-document.types";

/**
 * An employment's documents as HR files them (E-02 §11-§13, §27-§31, §54-§67,
 * §94-§99, §116; ADR 0007).
 *
 * Nothing here stores a file or writes a Document (§12, §200): a file is
 * uploaded through the Documents pipeline with the employment as its parent,
 * and filing it adds the one row that says what it is to HR. A renewal or a
 * replacement is a new file and a new row; the old row stops being current and
 * points at its successor, and nothing is overwritten (§13, §62, §63). Every
 * list starts from the reader's access clause (§204-§206), so a document a
 * reader may not open is not returned, counted or hinted at (§98).
 */

type Tx = Prisma.TransactionClient;

/** What a document stops being on the lists once it is renewed, replaced, put away or checked (§91, §194). */
const DOCUMENT_CONDITIONS = ["EMPLOYEE_DOCUMENT_EXPIRING", "EMPLOYEE_DOCUMENT_EXPIRED", "EMPLOYEE_DOCUMENT_UNVERIFIED"];

const LINK_SELECT = {
  id: true,
  companyId: true,
  employeeProfileId: true,
  documentId: true,
  category: true,
  title: true,
  visibility: true,
  verificationStatus: true,
  issuer: true,
  documentNumber: true,
  issueDate: true,
  expiryDate: true,
  effectiveFrom: true,
  effectiveTo: true,
  isCurrent: true,
  supersededById: true,
  amendsId: true,
  verifiedByMemberId: true,
  verifiedAt: true,
  verificationNote: true,
  verifiedDocumentVersionId: true,
  createdByMemberId: true,
  archivedAt: true,
  archiveReason: true,
  version: true,
  createdAt: true,
  document: {
    select: { id: true, name: true, originalFileName: true, mimeType: true, sizeBytes: true, storageStatus: true, status: true, currentVersionId: true },
  },
  supersededBy: { select: { id: true, title: true } },
  supersedes: { select: { id: true, title: true } },
  amends: { select: { id: true, title: true } },
} satisfies Prisma.EmployeeDocumentLinkSelect;

type LinkRow = Prisma.EmployeeDocumentLinkGetPayload<{ select: typeof LINK_SELECT }>;

const EMPLOYMENT_SELECT = {
  id: true,
  companyId: true,
  personProfileId: true,
  companyMemberId: true,
  employmentStatus: true,
  personProfile: PERSON_NAME_SELECT,
} satisfies Prisma.EmployeeProfileSelect;

type Employment = Prisma.EmployeeProfileGetPayload<{ select: typeof EMPLOYMENT_SELECT }>;

function fail(code: string, message: string, status: "CONFLICT" | "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" = "CONFLICT", field?: string): AccessError {
  return new AccessError(status, message, field ? { field, code, [field]: [message] } : { code });
}

const dateText = (value: Date | null) => (value ? dayOf(value) : null);
const dateValue = (value: string | null | undefined) => (value ? dbDay(value) : null);

/* -------------------------------------------------------------------------- */
/* The employment and the reader                                               */
/* -------------------------------------------------------------------------- */

async function loadEmployment(context: UserContext, employeeId: string): Promise<Employment> {
  // A company that has switched HR off keeps no employee file anybody can reach (PRD #7 §59).
  if (!context.moduleAccess.hr?.enabled) throw new AccessError("NOT_FOUND");
  const employment = await prisma.employeeProfile.findFirst({ where: { companyId: context.companyId, id: employeeId }, select: EMPLOYMENT_SELECT });
  if (!employment) throw new AccessError("NOT_FOUND");
  return employment;
}

type Reader = {
  /** The employment is the reader's own: they act through the self door, with the employee's rules. */
  self: boolean;
  /** HR reaches the employment: in scope, not their own. */
  hr: boolean;
};

async function readerOf(context: UserContext, employment: Employment): Promise<Reader> {
  const self = employment.companyMemberId !== null && employment.companyMemberId === context.membershipId;
  return { self, hr: !self && (await hrReachesEmployment(context, employment.id)) };
}

/** Whether this reader manages this link's category as HR (§49-§52). */
function managesAsHr(context: UserContext, reader: Reader, category: EmployeeDocumentCategory): boolean {
  return reader.hr && hrManageableClasses(context).includes(CATEGORY_RULES[category].class);
}

/** Whether this is the employee's own upload, filed by them, of a category they may add (§47, §79). */
function ownFiling(context: UserContext, reader: Reader, link: Pick<LinkRow, "category" | "createdByMemberId" | "archivedAt">): boolean {
  return reader.self && can(context, "hr.self.documents.upload") && CATEGORY_RULES[link.category].selfUpload && link.createdByMemberId === context.membershipId && link.archivedAt === null;
}

function actionsFor(context: UserContext, reader: Reader, link: LinkRow): EmployeeDocumentActions {
  const archived = link.archivedAt !== null;
  const status = link.verificationStatus;
  const hr = managesAsHr(context, reader, link.category);
  const own = ownFiling(context, reader, link);
  const open = !archived && status !== "SUPERSEDED";
  const checkable = reader.hr && CATEGORY_RULES[link.category].verifiable && can(context, "hr.document.verify") && status === "UNVERIFIED" && !archived;
  return {
    canEdit: open && (hr || (own && (status === "UNVERIFIED" || status === "REJECTED"))),
    canVerify: checkable,
    canReject: checkable,
    canResubmit: !archived && status === "REJECTED" && (hr || own),
    canRenew: open && link.isCurrent && (hr || own),
    canSupersede: open && link.isCurrent && hr,
    canArchive: !archived && hr,
    canReplaceFile: open && can(context, "document.update") && (hr || (own && status !== "VERIFIED")),
  };
}

async function memberNames(companyId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`]));
}

async function versionNumbers(documentVersionIds: Array<string | null>): Promise<Map<string, number>> {
  const ids = [...new Set(documentVersionIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.documentVersion.findMany({ where: { id: { in: ids } }, select: { id: true, versionNumber: true } });
  return new Map(rows.map((row) => [row.id, row.versionNumber]));
}

function toDTO(context: UserContext, reader: Reader, link: LinkRow, names: Map<string, string>, versions: Map<string, number>, today: string): EmployeeDocumentDTO {
  const rule = CATEGORY_RULES[link.category];
  const expiryDate = dateText(link.expiryDate);
  const expiry = expiryStateOf(expiryDate, today);
  const verified = link.verificationStatus === "VERIFIED" || link.verificationStatus === "EXPIRED";
  return {
    id: link.id,
    employeeId: link.employeeProfileId,
    category: link.category,
    categoryLabel: rule.label,
    group: rule.group,
    title: link.title,
    visibility: link.visibility,
    verificationStatus: link.verificationStatus,
    verifiable: rule.verifiable,
    issuer: link.issuer,
    documentNumber: link.documentNumber,
    issueDate: dateText(link.issueDate),
    expiryDate,
    effectiveFrom: dateText(link.effectiveFrom),
    effectiveTo: dateText(link.effectiveTo),
    isCurrent: link.isCurrent,
    archived: link.archivedAt !== null,
    archiveReason: link.archiveReason,
    expiry: expiry.state,
    daysToExpiry: expiry.days,
    supersededBy: link.supersededBy,
    supersedes: link.supersedes,
    amends: link.amends,
    verifiedBy: link.verifiedByMemberId ? (names.get(link.verifiedByMemberId) ?? "Former member") : null,
    verifiedAt: link.verifiedAt?.toISOString() ?? null,
    verificationNote: link.verificationNote,
    newFileSinceVerification: verified && link.verifiedDocumentVersionId !== null && link.document.currentVersionId !== link.verifiedDocumentVersionId,
    file: {
      documentId: link.document.id,
      fileName: link.document.originalFileName ?? link.document.name,
      mimeType: link.document.mimeType,
      sizeBytes: link.document.sizeBytes === null ? null : Number(link.document.sizeBytes),
      versionNumber: link.document.currentVersionId ? (versions.get(link.document.currentVersionId) ?? null) : null,
      storageStatus: link.document.storageStatus,
      archived: link.document.status === "ARCHIVED",
      href: `/documents/${link.document.id}`,
    },
    createdBy: link.createdByMemberId ? (names.get(link.createdByMemberId) ?? "Former member") : null,
    createdAt: link.createdAt.toISOString(),
    version: link.version,
    actions: actionsFor(context, reader, link),
  };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Sorting (§208): by category group, current first, newest issue first. */
function sortLinks<T extends { group: string; isCurrent: boolean; issueDate: string | null; createdAt?: string }>(rows: T[]): T[] {
  const order = new Map(DOCUMENT_GROUPS.map((group, index) => [group.key, index]));
  return [...rows].sort(
    (a, b) =>
      (order.get(a.group as never) ?? 99) - (order.get(b.group as never) ?? 99) ||
      Number(b.isCurrent) - Number(a.isCurrent) ||
      (b.issueDate ?? "").localeCompare(a.issueDate ?? "") ||
      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
}

/**
 * The Documents tab for one employment (§94-§99, §105-§111, §244).
 *
 * The reader gets the documents they may open, a summary of what the employee
 * shares with colleagues once verified, and files uploaded but not yet filed
 * that are theirs to file. Somebody who may do none of that, and may not read
 * profiles either, gets "not found": the employment is not confirmed to them.
 */
export async function listEmployeeDocuments(context: UserContext, employeeId: string): Promise<EmployeeDocumentsDTO> {
  const employment = await loadEmployment(context, employeeId);
  const reader = await readerOf(context, employment);
  const linkWhere = readableLinkWhere(context);
  const profileReader = can(context, "people.profile.view");
  if (!reader.self && !reader.hr && !linkWhere && !profileReader) throw new AccessError("NOT_FOUND");

  const today = todayDay();
  const [links, unfiledClause] = await Promise.all([
    linkWhere
      ? prisma.employeeDocumentLink.findMany({
          where: { AND: [linkWhere, { companyId: context.companyId, employeeProfileId: employment.id }] },
          select: LINK_SELECT,
          orderBy: [{ createdAt: "desc" }],
          take: 500,
        })
      : Promise.resolve([] as LinkRow[]),
    readableEmployeeDocumentWhere(context),
  ]);

  const seen = links.map((link) => link.id);
  // What colleagues may know: verified, shared with the group, current — never the file (§34, §103).
  const summaries = profileReader
    ? await prisma.employeeDocumentLink.findMany({
        where: {
          companyId: context.companyId,
          employeeProfileId: employment.id,
          visibility: "GROUP_SUMMARY",
          verificationStatus: "VERIFIED",
          isCurrent: true,
          archivedAt: null,
          id: { notIn: seen },
        },
        select: { id: true, category: true, title: true, issuer: true, issueDate: true, expiryDate: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];

  const unfiled = unfiledClause
    ? await prisma.document.findMany({
        where: { AND: [unfiledClause, { companyId: context.companyId, entityType: EMPLOYEE_RECORD_TYPE, entityId: employment.id, employeeDocumentLink: { is: null }, status: "ACTIVE" }] },
        select: { id: true, name: true, originalFileName: true, mimeType: true, sizeBytes: true, storageStatus: true, status: true, currentVersionId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  const [names, versions] = await Promise.all([
    memberNames(context.companyId, links.flatMap((link) => [link.verifiedByMemberId, link.createdByMemberId])),
    versionNumbers([...links.map((link) => link.document.currentVersionId), ...unfiled.map((row) => row.currentVersionId)]),
  ]);

  const documents = sortLinks(links.map((link) => toDTO(context, reader, link, names, versions, today)));
  const order = new Map(DOCUMENT_GROUPS.map((group, index) => [group.key, index]));
  const summaryRows = summaries
    .map(
      (row): EmployeeDocumentSummaryDTO => ({
        id: row.id,
        category: row.category,
        categoryLabel: CATEGORY_RULES[row.category].label,
        group: CATEGORY_RULES[row.category].group,
        title: row.title,
        issuer: row.issuer,
        issueDate: dateText(row.issueDate),
        expiryDate: dateText(row.expiryDate),
      }),
    )
    .sort((a, b) => (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99) || (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));

  const groups = DOCUMENT_GROUPS.map((group) => {
    const inGroup = documents.filter((row) => row.group === group.key && !row.archived);
    return {
      group: group.key,
      label: group.label,
      count: inGroup.length + summaryRows.filter((row) => row.group === group.key).length,
      expiring: inGroup.filter((row) => row.isCurrent && row.expiry === "EXPIRING").length,
      unverified: inGroup.filter((row) => row.verifiable && row.isCurrent && row.verificationStatus === "UNVERIFIED").length,
    };
  });

  const addable = reader.self ? addableCategories(context, "SELF") : reader.hr ? addableCategories(context, "HR") : [];
  return {
    employeeId: employment.id,
    personId: employment.personProfileId,
    name: personName(employment.personProfile),
    isSelf: reader.self,
    documents,
    summaries: summaryRows,
    unfiled: unfiled.map(
      (row): UnfiledDocumentDTO => ({
        documentId: row.id,
        name: row.name,
        fileName: row.originalFileName ?? row.name,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
        versionNumber: row.currentVersionId ? (versions.get(row.currentVersionId) ?? null) : null,
        storageStatus: row.storageStatus,
        archived: row.status === "ARCHIVED",
        href: `/documents/${row.id}`,
        uploadedAt: row.createdAt.toISOString(),
      }),
    ),
    groups,
    capabilities: {
      addable: addable.filter((entry) => entry.visibilities.length > 0),
      // The employee adds nothing to an employment that has ended; HR still files its last papers.
      open: reader.hr || employment.employmentStatus !== "ENDED",
    },
  };
}

/** One document this reader may open, with what they may do to it. */
export async function getEmployeeDocument(context: UserContext, employeeId: string, linkId: string): Promise<EmployeeDocumentDTO> {
  const employment = await loadEmployment(context, employeeId);
  const link = await findReadableLink(context, employment.id, linkId);
  const reader = await readerOf(context, employment);
  const [names, versions] = await Promise.all([memberNames(context.companyId, [link.verifiedByMemberId, link.createdByMemberId]), versionNumbers([link.document.currentVersionId])]);
  return toDTO(context, reader, link, names, versions, todayDay());
}

/** A link on this employment the reader may open — anything else, in any company, is the same "not found" (§186). */
async function findReadableLink(context: UserContext, employmentId: string, linkId: string, tx: Tx = prisma): Promise<LinkRow> {
  const where = readableLinkWhere(context);
  const link = where
    ? await tx.employeeDocumentLink.findFirst({ where: { AND: [where, { companyId: context.companyId, employeeProfileId: employmentId, id: linkId }] }, select: LINK_SELECT })
    : null;
  if (!link) throw fail("EMPLOYEE_DOCUMENT_NOT_FOUND", "That document is not on this employee's file.", "NOT_FOUND");
  return link;
}

/* -------------------------------------------------------------------------- */
/* Filing                                                                      */
/* -------------------------------------------------------------------------- */

function allowedVisibilities(context: UserContext, reader: Reader, category: EmployeeDocumentCategory): EmployeeDocumentVisibility[] {
  const entry = addableCategories(context, reader.self ? "SELF" : "HR").find((row) => row.category === category);
  return entry?.visibilities ?? [];
}

/** The reader may file or refile this category on this employment: as the employee, or as HR managing its class (§47-§53). */
function assertMayFile(context: UserContext, reader: Reader, category: EmployeeDocumentCategory): void {
  const rule = CATEGORY_RULES[category];
  if (reader.self) {
    if (!can(context, "hr.self.documents.upload")) throw new AccessError("FORBIDDEN");
    if (!rule.selfUpload) throw fail("EMPLOYEE_DOCUMENT_HR_ONLY", `HR files a ${rule.label.toLowerCase()}. Ask HR to add it.`, "FORBIDDEN", "category");
    return;
  }
  if (!reader.hr) throw new AccessError("NOT_FOUND");
  if (!hrManageableClasses(context).includes(rule.class)) throw fail("EMPLOYEE_DOCUMENT_CATEGORY_DENIED", `You cannot file a ${rule.label.toLowerCase()}.`, "FORBIDDEN", "category");
}

function resolveVisibility(context: UserContext, reader: Reader, category: EmployeeDocumentCategory, requested: EmployeeDocumentVisibility | undefined): EmployeeDocumentVisibility {
  const rule = CATEGORY_RULES[category];
  const allowed = allowedVisibilities(context, reader, category);
  const visibility = requested ?? (allowed.includes(rule.defaultVisibility) ? rule.defaultVisibility : allowed[0]);
  if (!visibility || !allowed.includes(visibility)) {
    throw fail("EMPLOYEE_DOCUMENT_VISIBILITY_DENIED", `A ${rule.label.toLowerCase()} cannot be shared that way.`, "VALIDATION_ERROR", "visibility");
  }
  return visibility;
}

function defaultTitle(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,6}$/, "").trim() || name;
}

function auditLabel(category: EmployeeDocumentCategory, employment: Employment): string {
  // The category and whose file — never the title, which may carry a salary or an identity number (§144).
  return `${CATEGORY_RULES[category].label} · ${personName(employment.personProfile)}`;
}

/** The employee, told a document was added to their file — when they may see it and have a login (§147, §148). */
async function tellEmployee(tx: Tx, context: UserContext, employment: Employment, link: { id: string; category: EmployeeDocumentCategory; visibility: EmployeeDocumentVisibility }, eventType: string): Promise<void> {
  if (!employment.companyMemberId || employment.companyMemberId === context.membershipId) return;
  if (!SELF_VISIBLE.includes(link.visibility)) return;
  const rule = CATEGORY_RULES[link.category];
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType,
    moduleKey: "hr",
    entityType: "employee_document",
    entityId: link.id,
    actorMemberId: context.membershipId,
    // What kind of document, only where the kind says nothing private (§148).
    payload: { memberIds: [employment.companyMemberId], categoryLabel: rule.class === "PROFESSIONAL" ? rule.label : null },
  });
}

/**
 * Files a document uploaded on this employment (§54, §55): what it is, its
 * dates, who may see it. With `replacesId` it renews or replaces a document
 * already filed — the new one is current, the old one superseded and kept
 * (§66, §91). The file itself is never touched or copied.
 */
export async function fileEmployeeDocument(context: UserContext, employeeId: string, input: FileEmployeeDocumentInput): Promise<EmployeeDocumentDTO> {
  const employment = await loadEmployment(context, employeeId);
  const reader = await readerOf(context, employment);
  if (!reader.self && !reader.hr) throw new AccessError("NOT_FOUND");
  assertMayFile(context, reader, input.category);
  if (reader.self && employment.employmentStatus === "ENDED") throw stateDenied("This employment has ended and takes no new documents.");
  const visibility = resolveVisibility(context, reader, input.category, input.visibility);

  // The file: uploaded on this employment, still unfiled, readable by this
  // reader, and through its checks (§54, §129, §197). Another company's, another
  // employee's or a made-up id are one refusal.
  const readable = await findReadableDocument(context, input.documentId);
  if (!readable || readable.entityType !== EMPLOYEE_RECORD_TYPE || readable.entityId !== employment.id) {
    throw invalidRecordLink("documentId", "CROSS_COMPANY_REFERENCE", "Upload the file to this employee's record first.");
  }
  if (readable.status !== "ACTIVE") throw fail("EMPLOYEE_DOCUMENT_FILE_ARCHIVED", "That file is archived.", "VALIDATION_ERROR", "documentId");
  if (readable.storageStatus !== "AVAILABLE") throw fail("EMPLOYEE_DOCUMENT_FILE_PENDING", "That file is still being checked. Try again in a moment.", "CONFLICT", "documentId");

  const rule = CATEGORY_RULES[input.category];
  if (input.amendsId && input.category !== "CONTRACT_AMENDMENT") throw fail("EMPLOYEE_DOCUMENT_AMENDS_ONLY", "Only a contract amendment amends a contract.", "VALIDATION_ERROR", "amendsId");

  const created = await runInTransaction("hr.employee_document.file", async (tx) => {
    if (await tx.employeeDocumentLink.findFirst({ where: { companyId: context.companyId, documentId: readable.id }, select: { id: true } })) {
      throw fail("EMPLOYEE_DOCUMENT_ALREADY_FILED", "That file is already on the employee's file.", "CONFLICT", "documentId");
    }
    const amends = input.amendsId ? await findReadableLink(context, employment.id, input.amendsId, tx).catch(() => null) : null;
    if (input.amendsId && (!amends || amends.category !== "EMPLOYMENT_CONTRACT")) {
      throw invalidRecordLink("amendsId", "CROSS_COMPANY_REFERENCE", "Choose a working contract of this employee.");
    }
    const replaces = input.replacesId ? await replaceable(context, reader, employment, input.replacesId, input.category, tx) : null;

    const link = await tx.employeeDocumentLink.create({
      data: {
        companyId: context.companyId,
        employeeProfileId: employment.id,
        documentId: readable.id,
        category: input.category,
        title: input.title ?? (replaces ? replaces.title : defaultTitle(readable.name)),
        visibility,
        issuer: input.issuer ?? null,
        documentNumber: input.documentNumber ?? null,
        issueDate: dateValue(input.issueDate),
        expiryDate: dateValue(input.expiryDate),
        effectiveFrom: dateValue(input.effectiveFrom),
        effectiveTo: dateValue(input.effectiveTo),
        amendsId: amends?.id ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, category: true, visibility: true },
    });

    if (replaces) {
      await applyTransition(tx, {
        machine: employeeDocumentVerificationMachine,
        action: "supersede",
        id: replaces.id,
        context,
        from: replaces.verificationStatus,
        expectedVersion: replaces.version,
        data: { isCurrent: false, supersededById: link.id },
      });
      await resolveAttentionForRecord(tx, context.companyId, "employee_document", replaces.id, DOCUMENT_CONDITIONS);
    }

    await recordUserAction(
      context,
      {
        actionKey: replaces ? AuditAction.EMPLOYEE_DOCUMENT_RENEWED : AuditAction.EMPLOYEE_DOCUMENT_LINKED,
        entity: { type: "EmployeeDocumentLink", id: link.id, label: auditLabel(input.category, employment) },
        before: replaces ? { replacesId: replaces.id, verificationStatus: replaces.verificationStatus, expiryDate: dateText(replaces.expiryDate) } : null,
        after: {
          employeeId: employment.id,
          documentId: readable.id,
          category: input.category,
          visibility,
          issueDate: input.issueDate ?? null,
          expiryDate: input.expiryDate ?? null,
          effectiveFrom: input.effectiveFrom ?? null,
          effectiveTo: input.effectiveTo ?? null,
          amendsId: amends?.id ?? null,
          replacesId: replaces?.id ?? null,
        },
        metadata: { via: reader.self ? "SELF" : "HR", class: rule.class },
      },
      { tx },
    );
    if (reader.hr) await tellEmployee(tx, context, employment, link, NotificationEvent.EMPLOYEE_DOCUMENT_ADDED);
    return link;
  });

  return getEmployeeDocument(context, employment.id, created.id);
}

/** A document the new one may take the place of: same employment and category, current, and this reader's to replace (§66, §91). */
async function replaceable(context: UserContext, reader: Reader, employment: Employment, linkId: string, category: EmployeeDocumentCategory, tx: Tx): Promise<LinkRow> {
  const old = await findReadableLink(context, employment.id, linkId, tx);
  if (old.category !== category) throw fail("EMPLOYEE_DOCUMENT_RENEWAL_CATEGORY", `A renewal is filed as ${CATEGORY_RULES[old.category].label.toLowerCase()}, like the document it renews.`, "VALIDATION_ERROR", "category");
  if (!old.isCurrent || old.archivedAt || old.verificationStatus === "SUPERSEDED") throw stateDenied("That document has already been replaced.");
  if (!managesAsHr(context, reader, old.category) && !ownFiling(context, reader, old)) throw new AccessError("FORBIDDEN");
  return old;
}

/* -------------------------------------------------------------------------- */
/* Changing what it is                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Corrects a document's category, title, dates or reach (§27, §97). HR, for a
 * category it manages; the employee, for their own filing until it has been
 * checked (§79). Its verification is never changed here (§31).
 */
export async function updateEmployeeDocument(context: UserContext, employeeId: string, linkId: string, input: UpdateEmployeeDocumentInput): Promise<EmployeeDocumentDTO> {
  const employment = await loadEmployment(context, employeeId);
  const reader = await readerOf(context, employment);
  const link = await findReadableLink(context, employment.id, linkId);
  const actions = actionsFor(context, reader, link);
  if (!actions.canEdit) throw link.archivedAt || link.verificationStatus === "SUPERSEDED" ? stateDenied("This document is no longer current and cannot be changed.") : new AccessError("FORBIDDEN");

  const category = input.category ?? link.category;
  if (category !== link.category) assertMayFile(context, reader, category);
  const allowed = allowedVisibilities(context, reader, category);
  const visibility = input.visibility ?? link.visibility;
  if (!allowed.includes(visibility)) {
    throw fail("EMPLOYEE_DOCUMENT_VISIBILITY_DENIED", `A ${CATEGORY_RULES[category].label.toLowerCase()} cannot be shared that way. Choose who may see it.`, "VALIDATION_ERROR", "visibility");
  }

  const next = {
    title: input.title === undefined ? link.title : (input.title ?? link.title),
    issuer: input.issuer === undefined ? link.issuer : input.issuer,
    documentNumber: input.documentNumber === undefined ? link.documentNumber : input.documentNumber,
    issueDate: input.issueDate === undefined ? dateText(link.issueDate) : input.issueDate,
    expiryDate: input.expiryDate === undefined ? dateText(link.expiryDate) : input.expiryDate,
    effectiveFrom: input.effectiveFrom === undefined ? dateText(link.effectiveFrom) : input.effectiveFrom,
    effectiveTo: input.effectiveTo === undefined ? dateText(link.effectiveTo) : input.effectiveTo,
  };
  if (next.issueDate && next.expiryDate && next.expiryDate < next.issueDate) throw fail("EMPLOYEE_DOCUMENT_DATES", "The expiry date is before the issue date.", "VALIDATION_ERROR", "expiryDate");
  if (next.effectiveFrom && next.effectiveTo && next.effectiveTo < next.effectiveFrom) throw fail("EMPLOYEE_DOCUMENT_DATES", "The end date is before the start date.", "VALIDATION_ERROR", "effectiveTo");

  const before = { category: link.category, visibility: link.visibility, issueDate: dateText(link.issueDate), expiryDate: dateText(link.expiryDate), effectiveFrom: dateText(link.effectiveFrom), effectiveTo: dateText(link.effectiveTo) };
  const after = { category, visibility, issueDate: next.issueDate, expiryDate: next.expiryDate, effectiveFrom: next.effectiveFrom, effectiveTo: next.effectiveTo };

  await runInTransaction("hr.employee_document.update", async (tx) => {
    const moved = await tx.employeeDocumentLink.updateMany({
      where: { companyId: context.companyId, id: link.id, verificationStatus: link.verificationStatus, version: input.expectedVersion },
      data: {
        category,
        visibility,
        title: next.title,
        issuer: next.issuer,
        documentNumber: next.documentNumber,
        issueDate: dateValue(next.issueDate),
        expiryDate: dateValue(next.expiryDate),
        effectiveFrom: dateValue(next.effectiveFrom),
        effectiveTo: dateValue(next.effectiveTo),
        version: { increment: 1 },
      },
    });
    if (moved.count === 0) throw stale();
    await recordUserAction(context, { actionKey: AuditAction.EMPLOYEE_DOCUMENT_METADATA_UPDATED, entity: { type: "EmployeeDocumentLink", id: link.id, label: auditLabel(category, employment) }, before, after }, { tx });
    if (visibility !== link.visibility) {
      await recordUserAction(context, { actionKey: AuditAction.EMPLOYEE_DOCUMENT_VISIBILITY_CHANGED, entity: { type: "EmployeeDocumentLink", id: link.id, label: auditLabel(category, employment) }, before: { visibility: link.visibility }, after: { visibility } }, { tx });
    }
  });
  return getEmployeeDocument(context, employment.id, link.id);
}

function stale(): AccessError {
  return fail("EMPLOYEE_DOCUMENT_STALE", "Somebody else changed this document. Reload it and try again.", "CONFLICT");
}

/* -------------------------------------------------------------------------- */
/* Verification (§29-§31, §72-§79)                                             */
/* -------------------------------------------------------------------------- */

type Decision = { action: "verify" | "reject" | "resubmit"; note: string | null; expectedVersion: number };

async function decide(context: UserContext, employeeId: string, linkId: string, decision: Decision): Promise<EmployeeDocumentDTO> {
  const employment = await loadEmployment(context, employeeId);
  const reader = await readerOf(context, employment);
  const link = await findReadableLink(context, employment.id, linkId);
  const actions = actionsFor(context, reader, link);
  const allowed = decision.action === "verify" ? actions.canVerify : decision.action === "reject" ? actions.canReject : actions.canResubmit;
  if (!allowed) {
    // Somebody's own document is never theirs to check (§74), and HR's own records are not evidence to check.
    if (reader.self && decision.action !== "resubmit") throw fail("EMPLOYEE_DOCUMENT_SELF_VERIFICATION", "You cannot verify your own document.", "FORBIDDEN");
    if (!CATEGORY_RULES[link.category].verifiable && decision.action !== "resubmit") throw fail("EMPLOYEE_DOCUMENT_NOT_VERIFIABLE", `A ${CATEGORY_RULES[link.category].label.toLowerCase()} is HR's own record and is not verified.`, "CONFLICT");
    assertTransitionAllowed(employeeDocumentVerificationMachine, { currentState: link.verificationStatus, action: decision.action, context, reason: decision.note });
    throw new AccessError("FORBIDDEN");
  }

  const data =
    decision.action === "resubmit"
      ? { verifiedByMemberId: null, verifiedAt: null, verificationNote: decision.note, verifiedDocumentVersionId: null }
      : { verifiedByMemberId: context.membershipId, verifiedAt: new Date(), verificationNote: decision.note, verifiedDocumentVersionId: link.document.currentVersionId };
  const actionKey = decision.action === "verify" ? AuditAction.EMPLOYEE_DOCUMENT_VERIFIED : decision.action === "reject" ? AuditAction.EMPLOYEE_DOCUMENT_REJECTED : AuditAction.EMPLOYEE_DOCUMENT_RESUBMITTED;
  const to: CredentialVerificationStatus = decision.action === "verify" ? "VERIFIED" : decision.action === "reject" ? "REJECTED" : "UNVERIFIED";

  await runInTransaction(`hr.employee_document.${decision.action}`, async (tx) => {
    // Guarded on the status and version the verifier read: of two verifiers acting at once, one wins (§192).
    await applyTransition(tx, {
      machine: employeeDocumentVerificationMachine,
      action: decision.action,
      id: link.id,
      context,
      from: link.verificationStatus,
      expectedVersion: decision.expectedVersion,
      reason: decision.note,
      data,
    });
    await recordUserAction(
      context,
      {
        actionKey,
        entity: { type: "EmployeeDocumentLink", id: link.id, label: auditLabel(link.category, employment) },
        before: { verificationStatus: link.verificationStatus },
        after: { verificationStatus: to, documentId: link.documentId },
        reason: decision.action === "reject" ? decision.note : null,
      },
      { tx },
    );
    if (decision.action !== "resubmit") {
      await resolveAttentionForRecord(tx, context.companyId, "employee_document", link.id, ["EMPLOYEE_DOCUMENT_UNVERIFIED"]);
      await tellEmployee(tx, context, employment, link, decision.action === "verify" ? NotificationEvent.EMPLOYEE_DOCUMENT_VERIFIED : NotificationEvent.EMPLOYEE_DOCUMENT_REJECTED);
    }
  });
  return getEmployeeDocument(context, employment.id, link.id);
}

export function verifyEmployeeDocument(context: UserContext, employeeId: string, linkId: string, input: VerifyEmployeeDocumentInput) {
  return decide(context, employeeId, linkId, { action: "verify", note: input.note ?? null, expectedVersion: input.expectedVersion });
}

export function rejectEmployeeDocument(context: UserContext, employeeId: string, linkId: string, input: RejectEmployeeDocumentInput) {
  return decide(context, employeeId, linkId, { action: "reject", note: input.reason, expectedVersion: input.expectedVersion });
}

export function resubmitEmployeeDocument(context: UserContext, employeeId: string, linkId: string, input: ResubmitEmployeeDocumentInput) {
  return decide(context, employeeId, linkId, { action: "resubmit", note: input.note ?? null, expectedVersion: input.expectedVersion });
}

/* -------------------------------------------------------------------------- */
/* Superseding and archiving (§64-§67)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Says a document no longer applies (§66): not current, superseded, kept.
 * With `replacementId`, by a document already filed on the same employment.
 */
export async function supersedeEmployeeDocument(context: UserContext, employeeId: string, linkId: string, input: SupersedeEmployeeDocumentInput): Promise<EmployeeDocumentDTO> {
  const employment = await loadEmployment(context, employeeId);
  const reader = await readerOf(context, employment);
  const link = await findReadableLink(context, employment.id, linkId);
  if (!actionsFor(context, reader, link).canSupersede) {
    throw link.isCurrent && !link.archivedAt && link.verificationStatus !== "SUPERSEDED" ? new AccessError("FORBIDDEN") : stateDenied("This document has already been replaced.");
  }
  const replacement = input.replacementId ? await findReadableLink(context, employment.id, input.replacementId).catch(() => null) : null;
  if (input.replacementId && (!replacement || replacement.id === link.id || replacement.verificationStatus === "SUPERSEDED" || replacement.archivedAt)) {
    throw invalidRecordLink("replacementId", "CROSS_COMPANY_REFERENCE", "Choose a current document of this employee.");
  }

  await runInTransaction("hr.employee_document.supersede", async (tx) => {
    await applyTransition(tx, {
      machine: employeeDocumentVerificationMachine,
      action: "supersede",
      id: link.id,
      context,
      from: link.verificationStatus,
      expectedVersion: input.expectedVersion,
      data: { isCurrent: false, supersededById: replacement?.id ?? null },
    });
    await resolveAttentionForRecord(tx, context.companyId, "employee_document", link.id, DOCUMENT_CONDITIONS);
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.EMPLOYEE_DOCUMENT_SUPERSEDED,
        entity: { type: "EmployeeDocumentLink", id: link.id, label: auditLabel(link.category, employment) },
        before: { verificationStatus: link.verificationStatus, isCurrent: true },
        after: { verificationStatus: "SUPERSEDED", isCurrent: false, replacementId: replacement?.id ?? null },
        reason: input.reason ?? null,
      },
      { tx },
    );
  }).catch((error: unknown) => {
    // Two documents cannot both have been replaced by one: the second loses cleanly (§66).
    if (isUniqueViolation(error)) throw fail("EMPLOYEE_DOCUMENT_REPLACEMENT_TAKEN", "That replacement already replaces another document.", "CONFLICT", "replacementId");
    throw error;
  });
  return getEmployeeDocument(context, employment.id, link.id);
}

/**
 * Takes a document off the employee's file — filed in error, or no longer
 * relevant — with a reason (§67, §97). The file and its history stay; HR
 * still sees it among archived documents, the employee no longer does.
 */
export async function archiveEmployeeDocument(context: UserContext, employeeId: string, linkId: string, input: ArchiveEmployeeDocumentInput): Promise<EmployeeDocumentDTO> {
  const employment = await loadEmployment(context, employeeId);
  const reader = await readerOf(context, employment);
  const link = await findReadableLink(context, employment.id, linkId);
  if (!actionsFor(context, reader, link).canArchive) throw link.archivedAt ? stateDenied("This document is already archived.") : new AccessError("FORBIDDEN");

  await runInTransaction("hr.employee_document.archive", async (tx) => {
    const moved = await tx.employeeDocumentLink.updateMany({
      where: { companyId: context.companyId, id: link.id, verificationStatus: link.verificationStatus, archivedAt: null, version: input.expectedVersion },
      data: { archivedAt: new Date(), archivedByMemberId: context.membershipId, archiveReason: input.reason, isCurrent: false, version: { increment: 1 } },
    });
    if (moved.count === 0) throw stale();
    await resolveAttentionForRecord(tx, context.companyId, "employee_document", link.id, DOCUMENT_CONDITIONS);
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.EMPLOYEE_DOCUMENT_ARCHIVED,
        entity: { type: "EmployeeDocumentLink", id: link.id, label: auditLabel(link.category, employment) },
        before: { archived: false, isCurrent: link.isCurrent },
        after: { archived: true, isCurrent: false },
        reason: input.reason,
      },
      { tx },
    );
  });
  return getEmployeeDocument(context, employment.id, link.id);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

/* -------------------------------------------------------------------------- */
/* Evidence for a qualification                                                */
/* -------------------------------------------------------------------------- */

/**
 * A file uploaded as the evidence for a qualification, filed on the
 * employment it was uploaded to — the same canonical document, filed once and
 * referenced by the qualification (§2, §59, §187). Already filed, it is left
 * as it is. The file keeps its own reach whatever the qualification's (§35):
 * the employee and HR.
 *
 * Runs in the caller's transaction; the caller has checked the file is this
 * person's, on an employment here, and readable to them.
 */
export async function fileSupportingDocument(
  tx: Tx,
  context: UserContext,
  input: { employmentId: string; documentId: string; category: EmployeeDocumentCategory; title: string; issuer: string | null; documentNumber: string | null; issueDate: string | null; expiryDate: string | null; employeeName: string },
): Promise<void> {
  const existing = await tx.employeeDocumentLink.findFirst({ where: { companyId: context.companyId, documentId: input.documentId }, select: { employeeProfileId: true } });
  if (existing) {
    if (existing.employeeProfileId !== input.employmentId) throw invalidRecordLink("documentId", "CROSS_COMPANY_REFERENCE", "Choose a file of this person.");
    return;
  }
  const link = await tx.employeeDocumentLink.create({
    data: {
      companyId: context.companyId,
      employeeProfileId: input.employmentId,
      documentId: input.documentId,
      category: input.category,
      title: input.title,
      visibility: "EMPLOYEE_AND_HR",
      issuer: input.issuer,
      documentNumber: input.documentNumber,
      issueDate: dateValue(input.issueDate),
      expiryDate: dateValue(input.expiryDate),
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.EMPLOYEE_DOCUMENT_LINKED,
      entity: { type: "EmployeeDocumentLink", id: link.id, label: `${CATEGORY_RULES[input.category].label} · ${input.employeeName}` },
      after: { employeeId: input.employmentId, documentId: input.documentId, category: input.category, visibility: "EMPLOYEE_AND_HR", issueDate: input.issueDate, expiryDate: input.expiryDate },
      metadata: { via: "QUALIFICATION" },
    },
    { tx },
  );
}

/* -------------------------------------------------------------------------- */
/* For the record registry                                                     */
/* -------------------------------------------------------------------------- */

/** The link as a record this reader may open — for notification links and attention (PRD #38 §82). */
export async function findEmployeeDocumentRecord(context: UserContext, linkId: string) {
  const where = readableLinkWhere(context);
  if (!where) return null;
  const link = await prisma.employeeDocumentLink.findFirst({
    where: { AND: [where, { companyId: context.companyId, id: linkId }] },
    select: { id: true, companyId: true, category: true, archivedAt: true, employeeProfile: { select: { personProfileId: true, companyMemberId: true } } },
  });
  if (!link) return null;
  return {
    type: "employee_document" as const,
    id: link.id,
    companyId: link.companyId,
    label: CATEGORY_RULES[link.category].label,
    href: `/people/${link.employeeProfile.personProfileId}?tab=documents`,
    projectId: null,
    archived: link.archivedAt !== null,
    stakeholderMemberIds: link.employeeProfile.companyMemberId ? [link.employeeProfile.companyMemberId] : [],
  };
}

export async function reachableEmployeeDocuments(context: UserContext, ids: string[]): Promise<string[]> {
  const where = readableLinkWhere(context);
  if (!where || ids.length === 0) return [];
  const rows = await prisma.employeeDocumentLink.findMany({ where: { AND: [where, { companyId: context.companyId, id: { in: ids } }] }, select: { id: true } });
  return rows.map((row) => row.id);
}
