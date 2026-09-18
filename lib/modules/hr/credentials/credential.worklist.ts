import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { companyDays } from "@/lib/core/notifications/company-day";
import { prisma } from "@/lib/database/prisma";
import { hrLinkWhere, hrReachWhere } from "@/lib/modules/hr/documents/employee-document.access";
import { CATEGORY_RULES, EMPLOYEE_DOCUMENT_CATEGORIES, expiryStateOf } from "@/lib/modules/hr/documents/employee-document.types";
import { dayOf } from "@/lib/modules/hr/employment/employment.dates";
import { hrQualificationWhere, readerPersonId } from "@/lib/modules/hr/qualifications/qualification.access";
import { QUALIFICATION_TYPE_RULES } from "@/lib/modules/hr/qualifications/qualification.types";
import { credentialConditionWhere, type CredentialCondition } from "./credential.expiry";
import type { CredentialWorkItemDTO, CredentialWorklistDTO, CredentialWorklistView } from "./credential.types";

/**
 * HR's credential worklists (E-02 §153, §154, §204).
 *
 * Read through the HR door only — the employee file HR reaches, the people it
 * reaches as HR, never the reader's own (§74) — and with the same conditions
 * the attention items and the expiry job use, so the three never disagree.
 * "To verify" lists only what the reader could verify: documents for
 * `hr.document.verify`, qualifications for `hr.qualification.verify`.
 * Somebody whose HR scope is only themselves — an employee reading their own
 * file — has no worklist at all.
 */

const PAGE = 100;
const VERIFIABLE = EMPLOYEE_DOCUMENT_CATEGORIES.filter((category) => CATEGORY_RULES[category].verifiable);
const CONDITION: Record<CredentialWorklistView, CredentialCondition> = { verify: "UNVERIFIED", expiring: "EXPIRING", expired: "EXPIRED" };

function documentWhere(context: UserContext, view: CredentialWorklistView, today: string): Prisma.EmployeeDocumentLinkWhereInput | null {
  const hr = hrLinkWhere(context);
  if (!hr || (view === "verify" && !can(context, "hr.document.verify"))) return null;
  return {
    AND: [
      hr,
      { isCurrent: true, archivedAt: null, employeeProfile: { employmentStatus: { not: "ENDED" } }, ...credentialConditionWhere(CONDITION[view], today) },
      view === "verify" ? { category: { in: VERIFIABLE } } : {},
    ],
  };
}

function qualificationWhere(context: UserContext, ownPersonId: string | null, view: CredentialWorklistView, today: string): Prisma.PersonQualificationWhereInput | null {
  const hr = hrQualificationWhere(context, ownPersonId);
  if (!hr || (view === "verify" && !can(context, "hr.qualification.verify"))) return null;
  return {
    AND: [
      hr,
      // Somebody still working here: a finished employment's HR has nothing left to chase.
      { person: { employments: { some: { companyId: context.companyId, employmentStatus: { not: "ENDED" } } } } },
      { isCurrent: true, archivedAt: null, ...credentialConditionWhere(CONDITION[view], today) },
    ],
  };
}

function views(context: UserContext): CredentialWorklistView[] {
  if (!can(context, "hr.document.view")) return [];
  const verifies = can(context, "hr.document.verify") || can(context, "hr.qualification.verify");
  return verifies ? ["verify", "expiring", "expired"] : ["expiring", "expired"];
}

/** The worklist of one view (the reader's first when none or another is asked for), or null for a reader who has none. */
export async function getCredentialWorklist(context: UserContext, requested: string | undefined): Promise<CredentialWorklistDTO | null> {
  const available = views(context);
  if (available.length === 0 || context.moduleAccess.hr?.enabled !== true) return null;
  const reachesAnybody = await prisma.employeeProfile.findFirst({ where: { AND: [hrReachWhere(context), { companyId: context.companyId }] }, select: { id: true } });
  if (!reachesAnybody) return null;
  const view = available.find((key) => key === requested) ?? available[0];
  const today = (await companyDays(context.companyId))(new Date()).day;
  const ownPersonId = await readerPersonId(context);

  const counts = { verify: 0, expiring: 0, expired: 0 } satisfies Record<CredentialWorklistView, number>;
  await Promise.all(
    available.map(async (key) => {
      const documents = documentWhere(context, key, today);
      const qualifications = qualificationWhere(context, ownPersonId, key, today);
      const [a, b] = await Promise.all([documents ? prisma.employeeDocumentLink.count({ where: documents }) : 0, qualifications ? prisma.personQualification.count({ where: qualifications }) : 0]);
      counts[key] = a + b;
    }),
  );

  // Oldest waiting first; soonest (or longest overdue) first.
  const byExpiry = view !== "verify";
  const documentsWhere = documentWhere(context, view, today);
  const qualificationsWhere = qualificationWhere(context, ownPersonId, view, today);
  const [documents, qualifications] = await Promise.all([
    documentsWhere
      ? prisma.employeeDocumentLink.findMany({
          where: documentsWhere,
          orderBy: byExpiry ? [{ expiryDate: "asc" }, { id: "asc" }] : [{ createdAt: "asc" }, { id: "asc" }],
          take: PAGE,
          select: {
            id: true,
            category: true,
            title: true,
            issuer: true,
            expiryDate: true,
            verificationStatus: true,
            createdAt: true,
            employeeProfileId: true,
            employeeProfile: { select: { personProfile: { select: { firstName: true, lastName: true } } } },
          },
        })
      : [],
    qualificationsWhere
      ? prisma.personQualification.findMany({
          where: qualificationsWhere,
          orderBy: byExpiry ? [{ expiryDate: "asc" }, { id: "asc" }] : [{ createdAt: "asc" }, { id: "asc" }],
          take: PAGE,
          select: { id: true, type: true, title: true, issuer: true, expiryDate: true, verificationStatus: true, createdAt: true, personProfileId: true, person: { select: { firstName: true, lastName: true } } },
        })
      : [],
  ]);

  const items: CredentialWorkItemDTO[] = [
    ...documents.map((row) => {
      const expiry = row.expiryDate ? dayOf(row.expiryDate) : null;
      return {
        id: row.id,
        kind: "employee_document" as const,
        kindLabel: `Document · ${CATEGORY_RULES[row.category].label}`,
        title: row.title,
        personName: `${row.employeeProfile.personProfile.firstName} ${row.employeeProfile.personProfile.lastName}`,
        issuer: row.issuer,
        expiryDate: expiry,
        daysToExpiry: expiry ? expiryStateOf(expiry, today).days : null,
        verificationStatus: row.verificationStatus,
        createdAt: row.createdAt.toISOString(),
        href: `/hr/employees/${row.employeeProfileId}/documents?document=${row.id}`,
      };
    }),
    ...qualifications.map((row) => {
      const expiry = row.expiryDate ? dayOf(row.expiryDate) : null;
      return {
        id: row.id,
        kind: "person_qualification" as const,
        kindLabel: `Qualification · ${QUALIFICATION_TYPE_RULES[row.type].label}`,
        title: row.title,
        personName: `${row.person.firstName} ${row.person.lastName}`,
        issuer: row.issuer,
        expiryDate: expiry,
        daysToExpiry: expiry ? expiryStateOf(expiry, today).days : null,
        verificationStatus: row.verificationStatus,
        createdAt: row.createdAt.toISOString(),
        href: `/people/${row.personProfileId}?tab=qualifications#qualification-${row.id}`,
      };
    }),
  ];
  items.sort((a, b) => (byExpiry ? (a.expiryDate ?? "").localeCompare(b.expiryDate ?? "") : a.createdAt.localeCompare(b.createdAt)) || a.id.localeCompare(b.id));

  return { view, views: available, counts, items: items.slice(0, PAGE), truncated: counts[view] > Math.min(items.length, PAGE) };
}
