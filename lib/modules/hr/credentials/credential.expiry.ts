import type { CredentialVerificationStatus, Prisma, QualificationVisibility } from "@prisma/client";

import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import type { AttentionRowPage } from "@/lib/core/notifications/attention.conditions";
import { companyDays } from "@/lib/core/notifications/company-day";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";
import { SELF_VISIBLE } from "@/lib/modules/hr/documents/employee-document.access";
import { CATEGORY_RULES, EXPIRING_SOON_DAYS, EXPIRY_WINDOWS, expiryWindowOf } from "@/lib/modules/hr/documents/employee-document.types";
import { addDays, daysBetween, dayOf, dbDay } from "@/lib/modules/hr/employment/employment.dates";
import { SELF_QUALIFICATION_VISIBLE } from "@/lib/modules/hr/qualifications/qualification.access";
import { QUALIFICATION_TYPE_RULES } from "@/lib/modules/hr/qualifications/qualification.types";

/**
 * Expiry of employee documents and qualifications (E-02 §80-§91, §149, §193;
 * PRD #51).
 *
 * Job `hr.credential-expiry` runs daily, one company at a time, in the
 * company's own day. A current document or qualification with an expiry date
 * is reminded about when it comes within 90, 60, 30 and 7 days, and once more
 * when the date has passed (§85); a verified one then becomes EXPIRED (§90).
 * Each reminder is claimed in the idempotency ledger in the same transaction
 * as its notice, so a rerun, an overlapping run or a retry tells nobody twice
 * (§84, §88, §193). The move is bound to the status, date and version the job
 * read, so a renewal saved in between is never overtaken (§91).
 *
 * A qualification is the person's, across the group: each company that
 * employs the person reminds its own HR and, where the person may see it,
 * the person — once per company (§87).
 */

const JOB = "hr.credential-expiry";
/** Rows read at a time; a company with more is walked by cursor, never cut off (PRD #51 §133-§138). */
const BATCH = 100;
const LIVE: CredentialVerificationStatus[] = ["UNVERIFIED", "VERIFIED"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** HR's verifiers in a company: who hears about the employee file's deadlines and waits (§87, §153). */
export async function credentialHolders(db: Prisma.TransactionClient | typeof prisma, companyId: string, permission: "hr.document.verify" | "hr.qualification.verify"): Promise<string[]> {
  const rows = await db.companyMember.findMany({ where: { companyId, status: "ACTIVE", role: { permissions: { some: { permission: { key: permission } } } } }, select: { id: true } });
  return rows.map((row) => row.id);
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const DOCUMENT_ROW = {
  id: true,
  companyId: true,
  category: true,
  visibility: true,
  verificationStatus: true,
  expiryDate: true,
  version: true,
  employeeProfile: { select: { companyMemberId: true, personProfile: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.EmployeeDocumentLinkSelect;

type DocumentRow = Prisma.EmployeeDocumentLinkGetPayload<{ select: typeof DOCUMENT_ROW }>;

/** What a document is called where the kind says nothing private (§93, §148). */
function documentLabel(row: Pick<DocumentRow, "category">): string {
  const rule = CATEGORY_RULES[row.category];
  return rule.class === "PROFESSIONAL" ? rule.label : "HR document";
}

/** The employee, where they may see the document and have a login; and HR's verifiers. */
async function documentRecipients(db: Prisma.TransactionClient | typeof prisma, companyId: string, row: DocumentRow): Promise<string[]> {
  const hr = await credentialHolders(db, companyId, "hr.document.verify");
  const employee = row.employeeProfile.companyMemberId && SELF_VISIBLE.includes(row.visibility) ? [row.employeeProfile.companyMemberId] : [];
  return [...new Set([...employee, ...hr])];
}

async function settleDocument(companyId: string, row: DocumentRow, today: string, now: Date): Promise<{ moved: boolean; told: boolean }> {
  const expires = dayOf(row.expiryDate!);
  const window = expiryWindowOf(expires, today);
  if (!window) return { moved: false, told: false };
  const moving = window === "EXPIRED" && row.verificationStatus === "VERIFIED";
  const claim = { companyId, jobKey: JOB, key: `${row.id}:${window}:${expires}` };
  if (!moving && (await idempotencyKeyClaimed(prisma, claim))) return { moved: false, told: false };
  const person = `${row.employeeProfile.personProfile.firstName} ${row.employeeProfile.personProfile.lastName}`;

  return prisma.$transaction(async (tx) => {
    if (moving) {
      const moved = await tx.employeeDocumentLink.updateMany({
        where: { companyId, id: row.id, verificationStatus: "VERIFIED", expiryDate: row.expiryDate, version: row.version },
        data: { verificationStatus: "EXPIRED", version: { increment: 1 } },
      });
      // Renewed or changed since it was read: that change stands, and says nothing expired.
      if (moved.count === 0) return { moved: false, told: false };
      await recordSystemAction(
        companyId,
        {
          actionKey: AuditAction.EMPLOYEE_DOCUMENT_EXPIRED,
          entity: { type: "EmployeeDocumentLink", id: row.id, label: `${CATEGORY_RULES[row.category].label} · ${person}` },
          before: { verificationStatus: "VERIFIED", expiryDate: expires },
          after: { verificationStatus: "EXPIRED", expiryDate: expires },
        },
        { tx },
      );
    }
    const memberIds = await documentRecipients(tx, companyId, row);
    if (memberIds.length === 0 || !(await claimIdempotencyKey(tx, claim))) return { moved: moving, told: false };
    await enqueueNotificationEvent(tx, {
      companyId,
      eventType: window === "EXPIRED" ? NotificationEvent.EMPLOYEE_DOCUMENT_EXPIRED : NotificationEvent.EMPLOYEE_DOCUMENT_EXPIRING,
      moduleKey: "hr",
      entityType: "employee_document",
      entityId: row.id,
      actorMemberId: null,
      projectId: null,
      payload: { memberIds, label: documentLabel(row), personName: person, expiresAt: expires, dateLabel: dateLabel(expires), window: String(window), days: daysBetween(today, expires), at: now.toISOString() },
    });
    return { moved: moving, told: true };
  });
}

/* -------------------------------------------------------------------------- */
/* Qualifications                                                              */
/* -------------------------------------------------------------------------- */

const QUALIFICATION_ROW = {
  id: true,
  personProfileId: true,
  type: true,
  title: true,
  visibility: true,
  verificationStatus: true,
  expiryDate: true,
  version: true,
  person: { select: { firstName: true, lastName: true, user: { select: { id: true } } } },
} satisfies Prisma.PersonQualificationSelect;

type QualificationRow = Prisma.PersonQualificationGetPayload<{ select: typeof QUALIFICATION_ROW }>;

/** Qualifications this company answers for: of people it employs today (§87, ADR 0007). */
function employedHere(companyId: string): Prisma.PersonQualificationWhereInput {
  return { person: { employments: { some: { companyId, employmentStatus: { not: "ENDED" } } } } };
}

async function qualificationRecipients(db: Prisma.TransactionClient | typeof prisma, companyId: string, row: Pick<QualificationRow, "visibility" | "person">): Promise<string[]> {
  const hr = await credentialHolders(db, companyId, "hr.qualification.verify");
  const self =
    row.person.user && SELF_QUALIFICATION_VISIBLE.includes(row.visibility as QualificationVisibility)
      ? await db.companyMember.findFirst({ where: { companyId, userId: row.person.user.id, status: "ACTIVE" }, select: { id: true } })
      : null;
  return [...new Set([...(self ? [self.id] : []), ...hr])];
}

async function settleQualification(companyId: string, row: QualificationRow, today: string, now: Date): Promise<{ moved: boolean; told: boolean }> {
  const expires = dayOf(row.expiryDate!);
  const window = expiryWindowOf(expires, today);
  if (!window) return { moved: false, told: false };
  const moving = window === "EXPIRED" && row.verificationStatus === "VERIFIED";
  const claim = { companyId, jobKey: JOB, key: `${row.id}:${window}:${expires}` };
  if (!moving && (await idempotencyKeyClaimed(prisma, claim))) return { moved: false, told: false };
  const person = `${row.person.firstName} ${row.person.lastName}`;

  return prisma.$transaction(async (tx) => {
    let moved = false;
    if (moving) {
      // Guarded like any other move; another employing company may have moved it first, and then only tells.
      const result = await tx.personQualification.updateMany({
        where: { id: row.id, verificationStatus: "VERIFIED", expiryDate: row.expiryDate, version: row.version },
        data: { verificationStatus: "EXPIRED", version: { increment: 1 } },
      });
      moved = result.count > 0;
      if (moved) {
        await recordSystemAction(
          companyId,
          {
            actionKey: AuditAction.EMPLOYEE_QUALIFICATION_EXPIRED,
            entity: { type: "PersonQualification", id: row.id, label: `${row.title} · ${person}` },
            before: { verificationStatus: "VERIFIED", expiryDate: expires },
            after: { verificationStatus: "EXPIRED", expiryDate: expires },
          },
          { tx },
        );
      } else {
        // Still told when another employing company moved it first; not when it was renewed or changed.
        const current = await tx.personQualification.findFirst({ where: { id: row.id }, select: { verificationStatus: true, expiryDate: true, isCurrent: true } });
        if (!current || current.verificationStatus !== "EXPIRED" || !current.isCurrent || current.expiryDate?.getTime() !== row.expiryDate?.getTime()) return { moved: false, told: false };
      }
    }
    const memberIds = await qualificationRecipients(tx, companyId, row);
    if (memberIds.length === 0 || !(await claimIdempotencyKey(tx, claim))) return { moved, told: false };
    await enqueueNotificationEvent(tx, {
      companyId,
      eventType: window === "EXPIRED" ? NotificationEvent.QUALIFICATION_EXPIRED : NotificationEvent.QUALIFICATION_EXPIRING,
      moduleKey: "people",
      entityType: "person_qualification",
      entityId: row.id,
      actorMemberId: null,
      projectId: null,
      payload: { memberIds, title: row.title, typeLabel: QUALIFICATION_TYPE_RULES[row.type].label, personName: person, expiresAt: expires, dateLabel: dateLabel(expires), window: String(window), days: daysBetween(today, expires), at: now.toISOString() },
    });
    return { moved, told: true };
  });
}

/* -------------------------------------------------------------------------- */
/* The job                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Job `hr.credential-expiry` (daily, §83-§85). `reminded` counts notices
 * enqueued, `expired` records moved to EXPIRED.
 *
 * Every row in the company is reached, however many. One that fails is logged
 * by id and stepped over, its move and its notice rolled back together; the
 * company's run then fails, after every other row has been settled
 * (PRD #51 §30-§36, §133-§138).
 */
export async function runCredentialExpiry(now = new Date()): Promise<{ reminded: number; expired: number }> {
  const counts = { reminded: 0, expired: 0 };
  const companyRun = await forEachCompany(
    JOB,
    async ({ companyId }) => {
      const today = (await companyDays(companyId))(now).day;
      const horizon = dbDay(addDays(today, EXPIRY_WINDOWS[0]));
      let failed = 0;
      const tally = (result: { moved: boolean; told: boolean }) => {
        if (result.moved) counts.expired += 1;
        if (result.told) counts.reminded += 1;
      };

      for (let after: string | undefined; !jobStopRequested(); ) {
        const rows = await prisma.employeeDocumentLink.findMany({
          where: { companyId, isCurrent: true, archivedAt: null, verificationStatus: { in: LIVE }, expiryDate: { not: null, lte: horizon }, employeeProfile: { employmentStatus: { not: "ENDED" } }, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: BATCH,
          select: DOCUMENT_ROW,
        });
        for (const row of rows) {
          try {
            tally(await settleDocument(companyId, row, today, now));
          } catch (error) {
            failed += 1;
            logger.error(`${JOB}.item_failed`, { companyId, employeeDocumentId: row.id, ...serialiseError(error) });
          }
        }
        if (rows.length < BATCH) break;
        after = rows[rows.length - 1]!.id;
      }

      for (let after: string | undefined; !jobStopRequested(); ) {
        const rows = await prisma.personQualification.findMany({
          where: { AND: [employedHere(companyId), { isCurrent: true, archivedAt: null, verificationStatus: { in: LIVE }, expiryDate: { not: null, lte: horizon } }, after ? { id: { gt: after } } : {}] },
          orderBy: { id: "asc" },
          take: BATCH,
          select: QUALIFICATION_ROW,
        });
        for (const row of rows) {
          try {
            tally(await settleQualification(companyId, row, today, now));
          } catch (error) {
            failed += 1;
            logger.error(`${JOB}.item_failed`, { companyId, qualificationId: row.id, ...serialiseError(error) });
          }
        }
        if (rows.length < BATCH) break;
        after = rows[rows.length - 1]!.id;
      }

      if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} employee documents or qualifications could not be settled`);
    },
    { moduleKey: "hr" },
  );
  assertEveryCompanySucceeded(JOB, companyRun);
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Attention (§149, §150, §153, §154)                                          */
/* -------------------------------------------------------------------------- */

export type CredentialCondition = "EXPIRING" | "EXPIRED" | "UNVERIFIED";

export type CredentialAttentionRow = {
  id: string;
  kind: "employee_document" | "person_qualification";
  label: string;
  personName: string;
  expiresAt: string | null;
  /** The employee's own member here, when they may see the record and are to be told. */
  selfMemberId: string | null;
  /** The person's own logins here, whatever the condition: never asked to check their own (§74). */
  ownMemberIds: string[];
  episode: string;
};

function conditionWhere(condition: CredentialCondition, today: string): { verificationStatus: { in: CredentialVerificationStatus[] }; expiryDate?: Prisma.DateTimeNullableFilter } {
  if (condition === "UNVERIFIED") return { verificationStatus: { in: ["UNVERIFIED"] } };
  if (condition === "EXPIRED") return { verificationStatus: { in: ["UNVERIFIED", "VERIFIED", "EXPIRED"] }, expiryDate: { lt: dbDay(today) } };
  return { verificationStatus: { in: LIVE }, expiryDate: { gte: dbDay(today), lte: dbDay(addDays(today, EXPIRING_SOON_DAYS)) } };
}

/**
 * Employee documents in a condition: current, not put away, of an employment
 * still running — expiring within 30 days, past their date, or waiting to be
 * checked (only a category that is checked at all). A page at a time.
 */
export async function documentsInCondition(companyId: string, condition: CredentialCondition, now: Date, id?: string, page?: AttentionRowPage): Promise<CredentialAttentionRow[]> {
  const today = (await companyDays(companyId))(now).day;
  const verifiable = Object.entries(CATEGORY_RULES).filter(([, rule]) => rule.verifiable).map(([category]) => category) as Array<keyof typeof CATEGORY_RULES>;
  const rows = await prisma.employeeDocumentLink.findMany({
    where: {
      companyId,
      isCurrent: true,
      archivedAt: null,
      employeeProfile: { employmentStatus: { not: "ENDED" } },
      ...conditionWhere(condition, today),
      ...(condition === "UNVERIFIED" ? { category: { in: verifiable } } : {}),
      ...(id ? { id } : {}),
      ...(page?.after ? { id: { gt: page.after } } : {}),
    },
    orderBy: { id: "asc" },
    take: page?.take ?? 500,
    select: { ...DOCUMENT_ROW, updatedAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: "employee_document" as const,
    label: documentLabel(row),
    personName: `${row.employeeProfile.personProfile.firstName} ${row.employeeProfile.personProfile.lastName}`,
    expiresAt: row.expiryDate ? dayOf(row.expiryDate) : null,
    // Somebody is not asked to check their own; told about their own deadlines where they may see them.
    selfMemberId: condition !== "UNVERIFIED" && SELF_VISIBLE.includes(row.visibility) ? row.employeeProfile.companyMemberId : null,
    ownMemberIds: row.employeeProfile.companyMemberId ? [row.employeeProfile.companyMemberId] : [],
    episode: condition === "UNVERIFIED" ? `v${row.version}` : row.expiryDate ? dayOf(row.expiryDate) : "none",
  }));
}

/** Qualifications of people this company employs, in a condition — the same rules as documents. */
export async function qualificationsInCondition(companyId: string, condition: CredentialCondition, now: Date, id?: string, page?: AttentionRowPage): Promise<CredentialAttentionRow[]> {
  const today = (await companyDays(companyId))(now).day;
  const rows = await prisma.personQualification.findMany({
    where: {
      AND: [
        employedHere(companyId),
        { isCurrent: true, archivedAt: null, ...conditionWhere(condition, today) },
        id ? { id } : {},
        page?.after ? { id: { gt: page.after } } : {},
      ],
    },
    orderBy: { id: "asc" },
    take: page?.take ?? 500,
    select: QUALIFICATION_ROW,
  });
  const members = new Map<string, string[]>();
  const userIds = [...new Set(rows.flatMap((row) => (row.person.user ? [row.person.user.id] : [])))];
  if (userIds.length > 0) {
    for (const member of await prisma.companyMember.findMany({ where: { companyId, userId: { in: userIds } }, select: { id: true, userId: true, status: true } })) {
      members.set(member.userId, [...(members.get(member.userId) ?? []), member.id]);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    kind: "person_qualification" as const,
    label: `${QUALIFICATION_TYPE_RULES[row.type].label}: ${row.title}`,
    personName: `${row.person.firstName} ${row.person.lastName}`,
    expiresAt: row.expiryDate ? dayOf(row.expiryDate) : null,
    selfMemberId: row.person.user && condition !== "UNVERIFIED" && SELF_QUALIFICATION_VISIBLE.includes(row.visibility) ? (members.get(row.person.user.id)?.[0] ?? null) : null,
    ownMemberIds: row.person.user ? (members.get(row.person.user.id) ?? []) : [],
    episode: condition === "UNVERIFIED" ? `v${row.version}` : row.expiryDate ? dayOf(row.expiryDate) : "none",
  }));
}

export { dateLabel as credentialDateLabel };
