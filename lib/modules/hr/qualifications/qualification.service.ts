import type { CredentialVerificationStatus, Prisma, QualificationType, QualificationVisibility } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, invalidRecordLink, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { assertTransitionAllowed } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import { EMPLOYEE_RECORD_TYPE, hrReachWhere, readableEmployeeDocumentWhere } from "@/lib/modules/hr/documents/employee-document.access";
import { fileSupportingDocument } from "@/lib/modules/hr/documents/employee-document.service";
import { categoryForQualification, expiryStateOf } from "@/lib/modules/hr/documents/employee-document.types";
import { dayOf, dbDay, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { personName } from "@/lib/modules/hr/hr.person";
import { fullQualificationWhere, qualificationRole, readerPersonId, summaryQualificationWhere } from "./qualification.access";
import { qualificationVerificationMachine } from "./qualification.machine";
import type {
  ArchiveQualificationInput,
  CreateQualificationInput,
  RejectQualificationInput,
  ResubmitQualificationInput,
  UpdateQualificationInput,
  VerifyQualificationInput,
} from "./qualification.schema";
import {
  HR_VISIBILITIES,
  QUALIFICATION_SECTIONS,
  QUALIFICATION_TYPE_RULES,
  SELF_VISIBILITIES,
  type PersonQualificationsDTO,
  type QualificationActions,
  type QualificationDTO,
  type QualificationSummaryDTO,
} from "./qualification.types";

/**
 * A person's skills and qualifications (E-02 §14, §15, §69-§79, §91, §100-§104,
 * §118; ADR 0007).
 *
 * The person's, across the group (answer 4, 2026-09-18): a transfer or a
 * rehire does not leave their licence behind. The person records their own;
 * HR records and checks them for people it employs. A qualification's evidence
 * is a canonical Document filed on the person's employment where it was
 * uploaded — referenced, never copied (§2, §59) — and opens only by that
 * file's own rules (§35, §104).
 *
 * The verification status moves only by semantic actions (§31): verify and
 * reject by a verifier who is not the person (§74), resubmit after a
 * rejection, renew — a new current record superseding the old (§91). Writes are
 * guarded by the status and version the actor read, so two verifiers acting at
 * once leave one consistent record (§192).
 */

type Tx = Prisma.TransactionClient;

/** What a qualification stops being on the lists once it is renewed, put away or checked (§91, §194). */
const QUALIFICATION_CONDITIONS = ["QUALIFICATION_EXPIRING", "QUALIFICATION_EXPIRED", "QUALIFICATION_UNVERIFIED"];

const QUALIFICATION_SELECT = {
  id: true,
  parentGroupId: true,
  personProfileId: true,
  companyId: true,
  type: true,
  title: true,
  issuer: true,
  documentNumber: true,
  issueDate: true,
  expiryDate: true,
  proficiency: true,
  verificationStatus: true,
  visibility: true,
  supportingDocumentId: true,
  isCurrent: true,
  supersededById: true,
  verifiedByMemberId: true,
  verifiedAt: true,
  verificationNote: true,
  verifiedDocumentVersionId: true,
  createdByMemberId: true,
  archivedAt: true,
  archiveReason: true,
  version: true,
  createdAt: true,
  company: { select: { id: true, name: true } },
  supportingDocument: { select: { id: true, name: true, originalFileName: true, currentVersionId: true } },
  supersededBy: { select: { id: true, title: true } },
  supersedes: { select: { id: true, title: true } },
} satisfies Prisma.PersonQualificationSelect;

type Row = Prisma.PersonQualificationGetPayload<{ select: typeof QUALIFICATION_SELECT }>;

type Role = Awaited<ReturnType<typeof qualificationRole>>;

function fail(code: string, message: string, status: "CONFLICT" | "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" = "CONFLICT", field?: string): AccessError {
  return new AccessError(status, message, field ? { field, code, [field]: [message] } : { code });
}

const dateText = (value: Date | null) => (value ? dayOf(value) : null);
const dateValue = (value: string | null | undefined) => (value ? dbDay(value) : null);

async function loadPerson(context: UserContext, personId: string) {
  const person = await prisma.personProfile.findFirst({ where: { parentGroupId: context.parentGroupId, id: personId }, select: { id: true, firstName: true, lastName: true, user: { select: { id: true } } } });
  if (!person) throw new AccessError("NOT_FOUND");
  return person;
}

/** Whether the reader created this record themselves, in any company of the group. */
async function createdByReader(context: UserContext, row: Pick<Row, "createdByMemberId">): Promise<boolean> {
  if (!row.createdByMemberId) return false;
  if (row.createdByMemberId === context.membershipId) return true;
  return (await prisma.companyMember.count({ where: { id: row.createdByMemberId, userId: context.userId } })) > 0;
}

function actionsFor(role: Role, row: Row, ownCreated: boolean): QualificationActions {
  const archived = row.archivedAt !== null;
  const status = row.verificationStatus;
  const open = !archived && status !== "SUPERSEDED";
  const hr = role.via === "HR";
  const self = role.via === "SELF";
  return {
    canEdit: open && (hr || (self && ownCreated && (status === "UNVERIFIED" || status === "REJECTED"))),
    canVerify: role.verifier && status === "UNVERIFIED" && !archived,
    canReject: role.verifier && status === "UNVERIFIED" && !archived,
    canResubmit: !archived && status === "REJECTED" && (hr || (self && ownCreated)),
    // The person may put a renewed licence forward even when HR recorded the first one (§79, §91).
    canRenew: open && row.isCurrent && (hr || self),
    canArchive: !archived && (hr || (self && ownCreated && status !== "VERIFIED")),
  };
}

async function memberNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { id: { in: unique } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`]));
}

/** Which supporting files this reader may open here: in this company, by the file's own rules (§35, §104). */
async function openableFiles(context: UserContext, rows: Row[]): Promise<Set<string>> {
  const ids = rows.filter((row) => row.supportingDocumentId && row.companyId === context.companyId).map((row) => row.supportingDocumentId!);
  if (ids.length === 0 || !can(context, "document.view")) return new Set();
  const clause = await readableEmployeeDocumentWhere(context);
  if (!clause) return new Set();
  const readable = await prisma.document.findMany({ where: { AND: [clause, { companyId: context.companyId, id: { in: ids }, status: "ACTIVE" }] }, select: { id: true } });
  return new Set(readable.map((row) => row.id));
}

function toDTO(row: Row, role: Role, ownCreated: boolean, names: Map<string, string>, openable: Set<string>, today: string): QualificationDTO {
  const rule = QUALIFICATION_TYPE_RULES[row.type];
  const expiryDate = dateText(row.expiryDate);
  const expiry = expiryStateOf(expiryDate, today);
  const verified = row.verificationStatus === "VERIFIED" || row.verificationStatus === "EXPIRED";
  const file = row.supportingDocument;
  return {
    id: row.id,
    personId: row.personProfileId,
    type: row.type,
    typeLabel: rule.label,
    section: rule.section,
    title: row.title,
    issuer: row.issuer,
    documentNumber: row.documentNumber,
    issueDate: dateText(row.issueDate),
    expiryDate,
    proficiency: row.proficiency,
    verificationStatus: row.verificationStatus,
    visibility: row.visibility,
    isCurrent: row.isCurrent,
    archived: row.archivedAt !== null,
    archiveReason: row.archiveReason,
    expiry: expiry.state,
    daysToExpiry: expiry.days,
    supersededBy: row.supersededBy,
    supersedes: row.supersedes,
    verifiedBy: row.verifiedByMemberId ? (names.get(row.verifiedByMemberId) ?? "Former member") : null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verificationNote: row.verificationNote,
    newFileSinceVerification: verified && row.verifiedDocumentVersionId !== (file?.currentVersionId ?? null),
    recordedIn: row.company,
    file: file
      ? {
          documentId: file.id,
          fileName: file.originalFileName ?? file.name,
          openable: openable.has(file.id),
          companyName: row.company.name,
          href: openable.has(file.id) ? `/documents/${file.id}` : null,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    actions: actionsFor(role, row, ownCreated),
  };
}

function sectionOrder(row: { section: string; isCurrent?: boolean; issueDate: string | null; title: string }) {
  return QUALIFICATION_SECTIONS.findIndex((section) => section.key === row.section);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The Skills & qualifications tab (§100-§105). The person and HR get the full
 * records they may see; everyone else who may read the profile gets the
 * verified summaries the person shares with the group, and nothing about the
 * rest — not even that there is more (§98, §103).
 */
export async function getPersonQualifications(context: UserContext, personId: string): Promise<PersonQualificationsDTO> {
  const person = await loadPerson(context, personId);
  const role = await qualificationRole(context, person.id);
  const isSelf = role.ownPersonId === person.id;
  const fullWhere = fullQualificationWhere(context, role.ownPersonId);

  const rows = fullWhere
    ? await prisma.personQualification.findMany({ where: { AND: [fullWhere, { personProfileId: person.id }] }, select: QUALIFICATION_SELECT, orderBy: [{ createdAt: "desc" }], take: 300 })
    : [];
  const summaries = can(context, "people.profile.view")
    ? await prisma.personQualification.findMany({
        where: { AND: [summaryQualificationWhere(context), { personProfileId: person.id, id: { notIn: rows.map((row) => row.id) } }] },
        select: { id: true, type: true, title: true, issuer: true, issueDate: true, expiryDate: true, proficiency: true },
        orderBy: [{ createdAt: "desc" }],
        take: 300,
      })
    : [];

  const today = todayDay();
  const [names, openable, ownCreated] = await Promise.all([
    memberNames(rows.map((row) => row.verifiedByMemberId)),
    openableFiles(context, rows),
    Promise.all(rows.map((row) => createdByReader(context, row))),
  ]);
  const records = rows
    .map((row, index) => toDTO(row, role, ownCreated[index]!, names, openable, today))
    .sort((a, b) => sectionOrder(a) - sectionOrder(b) || Number(b.isCurrent) - Number(a.isCurrent) || (b.issueDate ?? "").localeCompare(a.issueDate ?? "") || a.title.localeCompare(b.title));
  const summaryRows = summaries
    .map((row): QualificationSummaryDTO => ({
      id: row.id,
      type: row.type,
      typeLabel: QUALIFICATION_TYPE_RULES[row.type].label,
      section: QUALIFICATION_TYPE_RULES[row.type].section,
      title: row.title,
      issuer: row.issuer,
      issueDate: dateText(row.issueDate),
      expiryDate: dateText(row.expiryDate),
      proficiency: row.proficiency,
    }))
    .sort((a, b) => sectionOrder(a) - sectionOrder(b) || a.title.localeCompare(b.title));

  return {
    personId: person.id,
    isSelf,
    records: rows.length > 0 || isSelf || role.via === "HR" || role.verifier ? records : null,
    summaries: summaryRows,
    capabilities: {
      canAdd: role.via !== null,
      visibilities: [...(role.via === "SELF" ? SELF_VISIBILITIES : role.via === "HR" ? HR_VISIBILITIES : [])],
      fileEmploymentId: role.via ? await uploadEmployment(context, person.id, role) : null,
    },
  };
}

/**
 * The employment here a supporting file would be uploaded to: the person's
 * current one in this company, when this reader may add files to it — their
 * own through the self door, or somebody's as HR (§47, §49).
 */
async function uploadEmployment(context: UserContext, personId: string, role: Role): Promise<string | null> {
  if (!can(context, "document.create")) return null;
  if (role.via === "SELF" && !can(context, "hr.self.documents.upload")) return null;
  if (role.via === "HR" && !can(context, "hr.document.create")) return null;
  const where: Prisma.EmployeeProfileWhereInput =
    role.via === "SELF" ? { companyId: context.companyId, personProfileId: personId, companyMemberId: context.membershipId } : { AND: [hrReachWhere(context), { companyId: context.companyId, personProfileId: personId }] };
  const employment = await prisma.employeeProfile.findFirst({ where: { AND: [where, { employmentStatus: { not: "ENDED" } }] }, select: { id: true }, orderBy: { createdAt: "desc" } });
  return employment?.id ?? null;
}

async function findReadable(context: UserContext, personId: string, id: string, ownPersonId: string | null, tx: Tx = prisma): Promise<Row> {
  const where = fullQualificationWhere(context, ownPersonId);
  const row = where ? await tx.personQualification.findFirst({ where: { AND: [where, { personProfileId: personId, id }] }, select: QUALIFICATION_SELECT }) : null;
  if (!row) throw fail("QUALIFICATION_NOT_FOUND", "That qualification is not on this person's profile.", "NOT_FOUND");
  return row;
}

async function getOne(context: UserContext, personId: string, id: string): Promise<QualificationDTO> {
  const role = await qualificationRole(context, personId);
  const row = await findReadable(context, personId, id, role.ownPersonId);
  const [names, openable, ownCreated] = await Promise.all([memberNames([row.verifiedByMemberId]), openableFiles(context, [row]), createdByReader(context, row)]);
  return toDTO(row, role, ownCreated, names, openable, todayDay());
}

export { getOne as getQualification };

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

type Evidence = { documentId: string; employmentId: string; employeeName: string };

/**
 * A supporting file (§70, §71): uploaded on this person's employment in this
 * company, readable by the reader, checked and not archived. Another person's
 * file, another company's and a made-up id are one refusal (§129, §186).
 */
async function evidenceFor(context: UserContext, personId: string, documentId: string): Promise<Evidence> {
  const document = await findReadableDocument(context, documentId);
  const employment =
    document && document.entityType === EMPLOYEE_RECORD_TYPE && document.entityId
      ? await prisma.employeeProfile.findFirst({ where: { companyId: context.companyId, id: document.entityId, personProfileId: personId }, select: { id: true, personProfile: { select: { firstName: true, lastName: true } } } })
      : null;
  if (!document || !employment) throw invalidRecordLink("documentId", "CROSS_COMPANY_REFERENCE", "Upload the file to this person's record first.");
  if (document.status !== "ACTIVE") throw fail("QUALIFICATION_FILE_ARCHIVED", "That file is archived.", "VALIDATION_ERROR", "documentId");
  if (document.storageStatus !== "AVAILABLE") throw fail("QUALIFICATION_FILE_PENDING", "That file is still being checked. Try again in a moment.", "CONFLICT", "documentId");
  return { documentId: document.id, employmentId: employment.id, employeeName: personName(employment.personProfile) };
}

function resolveVisibility(role: Role, requested: QualificationVisibility | undefined, current?: QualificationVisibility): QualificationVisibility {
  const allowed = role.via === "SELF" ? SELF_VISIBILITIES : HR_VISIBILITIES;
  const visibility = requested ?? current ?? "EMPLOYEE_AND_HR";
  if (!allowed.includes(visibility)) throw fail("QUALIFICATION_VISIBILITY_DENIED", "You cannot share it that way.", "VALIDATION_ERROR", "visibility");
  return visibility;
}

async function tellPerson(tx: Tx, context: UserContext, person: { user: { id: string } | null }, row: { id: string; title: string }, eventType: string): Promise<void> {
  if (!person.user) return;
  const membership = await tx.companyMember.findFirst({ where: { companyId: context.companyId, userId: person.user.id, status: "ACTIVE" }, select: { id: true } });
  if (!membership || membership.id === context.membershipId) return;
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType,
    moduleKey: "people",
    entityType: "person_qualification",
    entityId: row.id,
    actorMemberId: context.membershipId,
    payload: { memberIds: [membership.id], title: row.title },
  });
}

function auditEntity(row: { id: string; title: string }, person: { firstName: string; lastName: string }) {
  return { type: "PersonQualification", id: row.id, label: `${row.title} · ${person.firstName} ${person.lastName}` };
}

/* -------------------------------------------------------------------------- */
/* Adding and changing                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Adds a qualification — the person's own (§69, §72), or somebody's as HR —
 * with its supporting file if there is one. With `renewsId` it renews one they
 * hold: the new one is current, the old one superseded and kept (§91, §194).
 */
export async function createQualification(context: UserContext, personId: string, input: CreateQualificationInput): Promise<QualificationDTO> {
  const person = await loadPerson(context, personId);
  const role = await qualificationRole(context, person.id);
  if (!role.via) throw role.ownPersonId === person.id || role.verifier ? new AccessError("FORBIDDEN") : new AccessError("NOT_FOUND");
  const visibility = resolveVisibility(role, input.visibility);
  const rule = QUALIFICATION_TYPE_RULES[input.type];
  const evidence = input.documentId ? await evidenceFor(context, person.id, input.documentId) : null;

  const created = await runInTransaction("hr.qualification.create", async (tx) => {
    const renews = input.renewsId ? await renewable(context, role, person.id, input.renewsId, input.type, tx) : null;
    if (evidence) {
      await fileSupportingDocument(tx, context, {
        employmentId: evidence.employmentId,
        documentId: evidence.documentId,
        category: categoryForQualification(input.type),
        title: input.title,
        issuer: input.issuer ?? null,
        documentNumber: input.documentNumber ?? null,
        issueDate: input.issueDate ?? null,
        expiryDate: input.expiryDate ?? null,
        employeeName: evidence.employeeName,
      });
    }
    const row = await tx.personQualification.create({
      data: {
        parentGroupId: context.parentGroupId,
        personProfileId: person.id,
        companyId: context.companyId,
        type: input.type,
        title: input.title,
        issuer: input.issuer ?? null,
        documentNumber: input.documentNumber ?? null,
        issueDate: dateValue(input.issueDate),
        expiryDate: dateValue(input.expiryDate),
        proficiency: rule.hasProficiency ? (input.proficiency ?? null) : null,
        visibility,
        supportingDocumentId: evidence?.documentId ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, title: true },
    });
    if (renews) {
      await moveStatus(tx, context, renews, "supersede", { isCurrent: false, supersededById: row.id });
      await resolveAttentionForRecord(tx, context.companyId, "person_qualification", renews.id, QUALIFICATION_CONDITIONS);
    }
    await recordUserAction(
      context,
      {
        actionKey: renews ? AuditAction.EMPLOYEE_QUALIFICATION_RENEWED : AuditAction.EMPLOYEE_QUALIFICATION_CREATED,
        entity: auditEntity(row, person),
        before: renews ? { renewsId: renews.id, verificationStatus: renews.verificationStatus, expiryDate: dateText(renews.expiryDate) } : null,
        after: {
          personId: person.id,
          type: input.type,
          title: input.title,
          issuer: input.issuer ?? null,
          issueDate: input.issueDate ?? null,
          expiryDate: input.expiryDate ?? null,
          proficiency: rule.hasProficiency ? (input.proficiency ?? null) : null,
          visibility,
          verificationStatus: "UNVERIFIED",
          supportingDocumentId: evidence?.documentId ?? null,
          renewsId: renews?.id ?? null,
        },
        metadata: { via: role.via },
      },
      { tx },
    );
    return row;
  });
  return getOne(context, person.id, created.id);
}

/** A qualification a renewal may take the place of: the same person's and type, current, and this reader's to renew. */
async function renewable(context: UserContext, role: Role, personId: string, id: string, type: QualificationType, tx: Tx): Promise<Row> {
  const old = await findReadable(context, personId, id, role.ownPersonId, tx);
  if (old.type !== type) throw fail("QUALIFICATION_RENEWAL_TYPE", `A renewal is a ${QUALIFICATION_TYPE_RULES[old.type].label.toLowerCase()}, like what it renews.`, "VALIDATION_ERROR", "type");
  if (!old.isCurrent || old.archivedAt || old.verificationStatus === "SUPERSEDED") throw stateDenied("That qualification has already been renewed.");
  return old;
}

/**
 * The guarded status write (§192): conditional on the status and version the
 * actor read, in the person's group — a qualification can be checked from any
 * company that employs the person, so the group is the boundary, not one
 * company. The machine's own table says whether the move is legal.
 */
async function moveStatus(tx: Tx, context: UserContext, row: Row, action: "verify" | "reject" | "resubmit" | "supersede", data: { isCurrent?: boolean; supersededById?: string | null; verifiedByMemberId?: string | null; verifiedAt?: Date | null; verificationNote?: string | null; verifiedDocumentVersionId?: string | null; supportingDocumentId?: string | null }, reason?: string | null): Promise<CredentialVerificationStatus> {
  const transition = assertTransitionAllowed(qualificationVerificationMachine, { currentState: row.verificationStatus, action, context, reason });
  const to = transition.to as CredentialVerificationStatus;
  const moved = await tx.personQualification.updateMany({
    where: { parentGroupId: context.parentGroupId, id: row.id, verificationStatus: row.verificationStatus, version: row.version },
    data: {
      verificationStatus: to,
      isCurrent: data.isCurrent,
      supersededById: data.supersededById,
      verifiedByMemberId: data.verifiedByMemberId,
      verifiedAt: data.verifiedAt,
      verificationNote: data.verificationNote,
      verifiedDocumentVersionId: data.verifiedDocumentVersionId,
      supportingDocumentId: data.supportingDocumentId,
      version: { increment: 1 },
    },
  });
  if (moved.count === 0) throw stale();
  return to;
}

function stale(): AccessError {
  return fail("QUALIFICATION_STALE", "Somebody else changed this qualification. Reload it and try again.", "CONFLICT");
}

/**
 * Corrects a qualification (§69, §79): HR, for somebody it employs; the person,
 * for their own until it has been checked. Its status is never set here (§31).
 */
export async function updateQualification(context: UserContext, personId: string, id: string, input: UpdateQualificationInput): Promise<QualificationDTO> {
  const person = await loadPerson(context, personId);
  const role = await qualificationRole(context, person.id);
  const row = await findReadable(context, person.id, id, role.ownPersonId);
  if (!actionsFor(role, row, await createdByReader(context, row)).canEdit) {
    throw row.archivedAt || row.verificationStatus === "SUPERSEDED" ? stateDenied("This qualification is no longer current and cannot be changed.") : new AccessError("FORBIDDEN");
  }
  if (input.expectedVersion !== row.version) throw stale();
  const type = input.type ?? row.type;
  const rule = QUALIFICATION_TYPE_RULES[type];
  const visibility = resolveVisibility(role, input.visibility, row.visibility);
  const evidence = input.documentId && input.documentId !== row.supportingDocumentId ? await evidenceFor(context, person.id, input.documentId) : null;
  // A file filed in another company cannot be swapped from here: it is not this company's to reach (§129).
  if (evidence && row.companyId !== context.companyId) throw fail("QUALIFICATION_FILE_ELSEWHERE", "Its file is kept by the company where it was recorded. Renew it here instead.", "CONFLICT", "documentId");

  const next = {
    title: input.title ?? row.title,
    issuer: input.issuer === undefined ? row.issuer : input.issuer,
    documentNumber: input.documentNumber === undefined ? row.documentNumber : input.documentNumber,
    issueDate: input.issueDate === undefined ? dateText(row.issueDate) : input.issueDate,
    expiryDate: input.expiryDate === undefined ? dateText(row.expiryDate) : input.expiryDate,
    proficiency: rule.hasProficiency ? (input.proficiency === undefined ? row.proficiency : input.proficiency) : null,
  };
  if (next.issueDate && next.expiryDate && next.expiryDate < next.issueDate) throw fail("QUALIFICATION_DATES", "The expiry date is before the issue date.", "VALIDATION_ERROR", "expiryDate");

  await runInTransaction("hr.qualification.update", async (tx) => {
    if (evidence) {
      await fileSupportingDocument(tx, context, { employmentId: evidence.employmentId, documentId: evidence.documentId, category: categoryForQualification(type), title: next.title, issuer: next.issuer, documentNumber: next.documentNumber, issueDate: next.issueDate, expiryDate: next.expiryDate, employeeName: evidence.employeeName });
    }
    const moved = await tx.personQualification.updateMany({
      where: { parentGroupId: context.parentGroupId, id: row.id, verificationStatus: row.verificationStatus, version: row.version },
      data: {
        type,
        title: next.title,
        issuer: next.issuer,
        documentNumber: next.documentNumber,
        issueDate: dateValue(next.issueDate),
        expiryDate: dateValue(next.expiryDate),
        proficiency: next.proficiency,
        visibility,
        supportingDocumentId: evidence ? evidence.documentId : row.supportingDocumentId,
        version: { increment: 1 },
      },
    });
    if (moved.count === 0) throw stale();
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.EMPLOYEE_QUALIFICATION_UPDATED,
        entity: auditEntity({ id: row.id, title: next.title }, person),
        before: { type: row.type, title: row.title, issuer: row.issuer, issueDate: dateText(row.issueDate), expiryDate: dateText(row.expiryDate), proficiency: row.proficiency, visibility: row.visibility, supportingDocumentId: row.supportingDocumentId },
        after: { type, title: next.title, issuer: next.issuer, issueDate: next.issueDate, expiryDate: next.expiryDate, proficiency: next.proficiency, visibility, supportingDocumentId: evidence ? evidence.documentId : row.supportingDocumentId },
      },
      { tx },
    );
  });
  return getOne(context, person.id, row.id);
}

/* -------------------------------------------------------------------------- */
/* Verification (§72-§79)                                                      */
/* -------------------------------------------------------------------------- */

async function decide(context: UserContext, personId: string, id: string, decision: { action: "verify" | "reject" | "resubmit"; note: string | null; expectedVersion: number; documentId?: string | null }): Promise<QualificationDTO> {
  const person = await loadPerson(context, personId);
  const role = await qualificationRole(context, person.id);
  const row = await findReadable(context, person.id, id, role.ownPersonId);
  const actions = actionsFor(role, row, await createdByReader(context, row));
  const allowed = decision.action === "resubmit" ? actions.canResubmit : decision.action === "verify" ? actions.canVerify : actions.canReject;
  if (!allowed) {
    // The person never checks their own (§74, §191).
    if (role.ownPersonId === person.id && decision.action !== "resubmit") throw fail("QUALIFICATION_SELF_VERIFICATION", "You cannot verify your own qualification.", "FORBIDDEN");
    assertTransitionAllowed(qualificationVerificationMachine, { currentState: row.verificationStatus, action: decision.action, context, reason: decision.note });
    throw new AccessError("FORBIDDEN");
  }
  if (decision.expectedVersion !== row.version) throw stale();
  const evidence = decision.action === "resubmit" && decision.documentId && decision.documentId !== row.supportingDocumentId ? await evidenceFor(context, person.id, decision.documentId) : null;

  await runInTransaction(`hr.qualification.${decision.action}`, async (tx) => {
    if (evidence) {
      await fileSupportingDocument(tx, context, { employmentId: evidence.employmentId, documentId: evidence.documentId, category: categoryForQualification(row.type), title: row.title, issuer: row.issuer, documentNumber: row.documentNumber, issueDate: dateText(row.issueDate), expiryDate: dateText(row.expiryDate), employeeName: evidence.employeeName });
    }
    const current = row.supportingDocumentId ? await tx.document.findFirst({ where: { companyId: row.companyId, id: row.supportingDocumentId }, select: { currentVersionId: true } }) : null;
    const to = await moveStatus(
      tx,
      context,
      row,
      decision.action,
      decision.action === "resubmit"
        ? { verifiedByMemberId: null, verifiedAt: null, verificationNote: decision.note, verifiedDocumentVersionId: null, supportingDocumentId: evidence ? evidence.documentId : row.supportingDocumentId }
        : { verifiedByMemberId: context.membershipId, verifiedAt: new Date(), verificationNote: decision.note, verifiedDocumentVersionId: current?.currentVersionId ?? null },
      decision.note,
    );
    await recordUserAction(
      context,
      {
        actionKey: decision.action === "verify" ? AuditAction.EMPLOYEE_QUALIFICATION_VERIFIED : decision.action === "reject" ? AuditAction.EMPLOYEE_QUALIFICATION_REJECTED : AuditAction.EMPLOYEE_QUALIFICATION_RESUBMITTED,
        entity: auditEntity(row, person),
        before: { verificationStatus: row.verificationStatus },
        after: { verificationStatus: to, supportingDocumentId: evidence ? evidence.documentId : row.supportingDocumentId },
        reason: decision.action === "reject" ? decision.note : null,
      },
      { tx },
    );
    if (decision.action !== "resubmit") await resolveAttentionForRecord(tx, context.companyId, "person_qualification", row.id, ["QUALIFICATION_UNVERIFIED"]);
    if (decision.action !== "resubmit") await tellPerson(tx, context, person, row, decision.action === "verify" ? NotificationEvent.QUALIFICATION_VERIFIED : NotificationEvent.QUALIFICATION_REJECTED);
  });
  return getOne(context, person.id, row.id);
}

export function verifyQualification(context: UserContext, personId: string, id: string, input: VerifyQualificationInput) {
  return decide(context, personId, id, { action: "verify", note: input.note ?? null, expectedVersion: input.expectedVersion });
}

export function rejectQualification(context: UserContext, personId: string, id: string, input: RejectQualificationInput) {
  return decide(context, personId, id, { action: "reject", note: input.reason, expectedVersion: input.expectedVersion });
}

export function resubmitQualification(context: UserContext, personId: string, id: string, input: ResubmitQualificationInput) {
  return decide(context, personId, id, { action: "resubmit", note: input.note ?? null, expectedVersion: input.expectedVersion, documentId: input.documentId });
}

/** Takes a qualification off the profile, with a reason; its history stays (§67). */
export async function archiveQualification(context: UserContext, personId: string, id: string, input: ArchiveQualificationInput): Promise<QualificationDTO> {
  const person = await loadPerson(context, personId);
  const role = await qualificationRole(context, person.id);
  const row = await findReadable(context, person.id, id, role.ownPersonId);
  if (!actionsFor(role, row, await createdByReader(context, row)).canArchive) throw row.archivedAt ? stateDenied("This qualification is already archived.") : new AccessError("FORBIDDEN");

  await runInTransaction("hr.qualification.archive", async (tx) => {
    const moved = await tx.personQualification.updateMany({
      where: { parentGroupId: context.parentGroupId, id: row.id, verificationStatus: row.verificationStatus, archivedAt: null, version: input.expectedVersion },
      data: { archivedAt: new Date(), archivedByMemberId: context.membershipId, archiveReason: input.reason, isCurrent: false, version: { increment: 1 } },
    });
    if (moved.count === 0) throw stale();
    await resolveAttentionForRecord(tx, context.companyId, "person_qualification", row.id, QUALIFICATION_CONDITIONS);
    await recordUserAction(context, { actionKey: AuditAction.EMPLOYEE_QUALIFICATION_ARCHIVED, entity: auditEntity(row, person), before: { archived: false, isCurrent: row.isCurrent }, after: { archived: true, isCurrent: false }, reason: input.reason }, { tx });
  });
  return getOne(context, person.id, row.id);
}

/* -------------------------------------------------------------------------- */
/* For the record registry                                                     */
/* -------------------------------------------------------------------------- */

/** The qualification as a record this reader may see in full — for notification links (PRD #38 §82). */
export async function findQualificationRecord(context: UserContext, id: string) {
  const where = fullQualificationWhere(context, await readerPersonId(context));
  if (!where) return null;
  const row = await prisma.personQualification.findFirst({ where: { AND: [where, { id }] }, select: { id: true, title: true, personProfileId: true, archivedAt: true } });
  if (!row) return null;
  return {
    type: "person_qualification" as const,
    id: row.id,
    companyId: context.companyId,
    label: row.title,
    href: `/people/${row.personProfileId}?tab=qualifications`,
    projectId: null,
    archived: row.archivedAt !== null,
    stakeholderMemberIds: [],
  };
}

export async function reachableQualifications(context: UserContext, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const where = fullQualificationWhere(context, await readerPersonId(context));
  if (!where) return [];
  const rows = await prisma.personQualification.findMany({ where: { AND: [where, { id: { in: ids } }] }, select: { id: true } });
  return rows.map((row) => row.id);
}
