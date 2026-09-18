import type { EmployeeDocumentCategory, Prisma, QualificationType } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { companyDays } from "@/lib/core/notifications/company-day";
import { prisma } from "@/lib/database/prisma";
import { hrLinkWhere, hrReachWhere } from "@/lib/modules/hr/documents/employee-document.access";
import { CATEGORY_RULES, DOCUMENT_GROUPS, EMPLOYEE_DOCUMENT_CATEGORIES, type DocumentGroup } from "@/lib/modules/hr/documents/employee-document.types";
import { hrQualificationWhere, readerPersonId } from "@/lib/modules/hr/qualifications/qualification.access";
import { QUALIFICATION_TYPE_RULES, QUALIFICATION_TYPES } from "@/lib/modules/hr/qualifications/qualification.types";
import { credentialConditionWhere } from "./credential.expiry";

/**
 * HR's credential reports (E-02 §157-§159).
 *
 * Counts, never files: coverage of each kind of qualification among the people
 * HR looks after, the qualifications most held, and the employee file by
 * category. Read through the HR door only, like the worklists — the people and
 * files this reader reaches as HR, never their own — so a report says no more
 * than the lists it summarises (§158). A pay document is counted only for a
 * reader of pay documents, and nothing about it but that it exists (§159).
 */

export type QualificationCoverageRow = {
  type: QualificationType;
  label: string;
  /** People holding a verified, current one. */
  holders: number;
  /** Of the people this reader looks after, the share holding one. */
  coverage: number;
  unverified: number;
  expiring: number;
  expired: number;
};

export type QualificationTitleRow = { type: QualificationType; typeLabel: string; title: string; holders: number };

export type QualificationReportDTO = { people: number; coverage: QualificationCoverageRow[]; titles: QualificationTitleRow[] };

export type DocumentCategoryRow = {
  category: EmployeeDocumentCategory;
  label: string;
  group: DocumentGroup;
  groupLabel: string;
  current: number;
  unverified: number;
  expiring: number;
  expired: number;
};

export function hasCredentialReports(context: UserContext): boolean {
  return can(context, "hr.report.view") && can(context, "hr.document.view");
}

async function today(context: UserContext): Promise<string> {
  return (await companyDays(context.companyId))(new Date()).day;
}

/** Coverage, waiting, running out and run out, by kind of qualification; and the ones most held. */
export async function qualificationReport(context: UserContext): Promise<QualificationReportDTO> {
  const empty = { people: 0, coverage: [], titles: [] };
  if (!hasCredentialReports(context)) return empty;
  const hr = hrQualificationWhere(context, await readerPersonId(context));
  if (!hr) return empty;
  const day = await today(context);
  const working: Prisma.EmployeeProfileWhereInput = { companyId: context.companyId, employmentStatus: { not: "ENDED" } };
  const current: Prisma.PersonQualificationWhereInput = { AND: [hr, { person: { employments: { some: working } } }, { isCurrent: true, archivedAt: null }] };
  const where = (extra: Prisma.PersonQualificationWhereInput): Prisma.PersonQualificationWhereInput => ({ AND: [current, extra] });

  const [people, holders, unverified, expiring, expired, titles] = await Promise.all([
    prisma.personProfile.count({ where: { employments: { some: { AND: [hrReachWhere(context), working] } } } }),
    prisma.personQualification.groupBy({ by: ["type", "personProfileId"], where: where({ verificationStatus: "VERIFIED" }) }),
    prisma.personQualification.groupBy({ by: ["type"], where: where(credentialConditionWhere("UNVERIFIED", day)), _count: { _all: true } }),
    prisma.personQualification.groupBy({ by: ["type"], where: where(credentialConditionWhere("EXPIRING", day)), _count: { _all: true } }),
    prisma.personQualification.groupBy({ by: ["type"], where: where(credentialConditionWhere("EXPIRED", day)), _count: { _all: true } }),
    prisma.personQualification.groupBy({ by: ["type", "title"], where: where({ verificationStatus: "VERIFIED" }), _count: { personProfileId: true } }),
  ]);

  const count = (rows: Array<{ type: QualificationType; _count: { _all: number } }>, type: QualificationType) => rows.find((row) => row.type === type)?._count._all ?? 0;
  const coverage = QUALIFICATION_TYPES.map((type) => {
    const held = holders.filter((row) => row.type === type).length;
    return {
      type,
      label: QUALIFICATION_TYPE_RULES[type].label,
      holders: held,
      coverage: people > 0 ? held / people : 0,
      unverified: count(unverified, type),
      expiring: count(expiring, type),
      expired: count(expired, type),
    };
  }).filter((row) => row.holders + row.unverified + row.expiring + row.expired > 0);

  return {
    people,
    coverage,
    titles: titles
      .map((row) => ({ type: row.type, typeLabel: QUALIFICATION_TYPE_RULES[row.type].label, title: row.title, holders: row._count.personProfileId }))
      .sort((a, b) => b.holders - a.holders || a.title.localeCompare(b.title))
      .slice(0, 20),
  };
}

/** The employee file by category: what is on file, waiting to be checked, running out and run out. */
export async function employeeDocumentReport(context: UserContext): Promise<DocumentCategoryRow[]> {
  if (!hasCredentialReports(context)) return [];
  const hr = hrLinkWhere(context);
  if (!hr) return [];
  const day = await today(context);
  const current: Prisma.EmployeeDocumentLinkWhereInput = { AND: [hr, { isCurrent: true, archivedAt: null, employeeProfile: { employmentStatus: { not: "ENDED" } } }] };
  const where = (extra: Prisma.EmployeeDocumentLinkWhereInput): Prisma.EmployeeDocumentLinkWhereInput => ({ AND: [current, extra] });
  const verifiable = EMPLOYEE_DOCUMENT_CATEGORIES.filter((category) => CATEGORY_RULES[category].verifiable);

  const [all, unverified, expiring, expired] = await Promise.all([
    prisma.employeeDocumentLink.groupBy({ by: ["category"], where: current, _count: { _all: true } }),
    prisma.employeeDocumentLink.groupBy({ by: ["category"], where: where({ ...credentialConditionWhere("UNVERIFIED", day), category: { in: verifiable } }), _count: { _all: true } }),
    prisma.employeeDocumentLink.groupBy({ by: ["category"], where: where(credentialConditionWhere("EXPIRING", day)), _count: { _all: true } }),
    prisma.employeeDocumentLink.groupBy({ by: ["category"], where: where(credentialConditionWhere("EXPIRED", day)), _count: { _all: true } }),
  ]);
  const count = (rows: Array<{ category: EmployeeDocumentCategory; _count: { _all: number } }>, category: EmployeeDocumentCategory) => rows.find((row) => row.category === category)?._count._all ?? 0;
  const groupLabel = new Map(DOCUMENT_GROUPS.map((group) => [group.key, group.label]));
  const order = new Map(DOCUMENT_GROUPS.map((group, index) => [group.key, index]));

  return EMPLOYEE_DOCUMENT_CATEGORIES.map((category) => {
    const rule = CATEGORY_RULES[category];
    return {
      category,
      label: rule.label,
      group: rule.group,
      groupLabel: groupLabel.get(rule.group) ?? rule.group,
      current: count(all, category),
      unverified: count(unverified, category),
      expiring: count(expiring, category),
      expired: count(expired, category),
    };
  })
    .filter((row) => row.current > 0)
    .sort((a, b) => (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99) || a.label.localeCompare(b.label));
}
