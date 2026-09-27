import type { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { hrLinkWhere, SELF_VISIBLE } from "@/lib/modules/hr/documents/employee-document.access";
import { CATEGORY_RULES } from "@/lib/modules/hr/documents/employee-document.types";
import { hrQualificationWhere, readerPersonId, SELF_QUALIFICATION_VISIBLE } from "@/lib/modules/hr/qualifications/qualification.access";
import { QUALIFICATION_TYPE_RULES } from "@/lib/modules/hr/qualifications/qualification.types";
import type { CalendarEventDTO, CalendarProvider } from "../calendar.types";
import { compact, dateWindow, onBusinessDate, SOURCE_LIMIT, sourceRows, wants } from "./provider.helpers";

/**
 * When licences, permits and certificates run out (E-02 §92, §93).
 *
 * All-day, on the expiry date, for two readers:
 *
 *   the person      their own current documents and qualifications, as far as
 *                   they may see them: "Driving licence expires"
 *   HR              the employee files and people it reaches as HR, never its
 *                   own that way: "Ethan Cole — Driving licence expires"
 *
 * An event is named by what kind of thing runs out, never by its title or
 * number, and an HR-private kind only as "HR document" (§93) — a calendar is
 * shown on shared screens and exported. Company-level dates: a project filter
 * finds none. Source-owned, never moved here. It lives with the leave provider,
 * so the calendar reads HR and HR never reads the calendar.
 */

const LIVE = ["UNVERIFIED", "VERIFIED", "EXPIRED"] as const;

function documentKind(category: keyof typeof CATEGORY_RULES): string {
  const rule = CATEGORY_RULES[category];
  return rule.class === "PROFESSIONAL" ? rule.label : "HR document";
}

export const credentialCalendarProvider: CalendarProvider = {
  key: "hr-credentials",
  moduleKey: "hr",
  categories: ["HR"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => canAccessModule(context, "hr") && (can(context, "hr.self.documents") || can(context, "hr.document.view")),
  async getEvents(input) {
    const { context, filters } = input;
    if (!wants(input, "HR") || filters.projectIds?.length) return [];
    const expiring = { isCurrent: true, archivedAt: null, verificationStatus: { in: [...LIVE] }, expiryDate: dateWindow(input) };
    const ownPersonId = await readerPersonId(context);
    const events: Array<CalendarEventDTO | null> = [];

    const onlyMembers = filters.memberIds?.length ? filters.memberIds : null;
    const includeOwn = !onlyMembers || onlyMembers.includes(context.membershipId);

    // Their own, as the employee file shows it to them.
    if (includeOwn && can(context, "hr.self.documents")) {
      const rows = await sourceRows(input, prisma.employeeDocumentLink.findMany({
        where: { companyId: context.companyId, employeeProfile: { companyMemberId: context.membershipId }, visibility: { in: SELF_VISIBLE }, ...expiring },
        orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
        select: { id: true, category: true, verificationStatus: true, expiryDate: true, employeeProfile: { select: { personProfileId: true } } },
      }));
      for (const row of rows) {
        events.push(
          onBusinessDate(input, row.expiryDate!, {
            id: `hr-credentials:document:${row.id}`,
            sourceType: "employee_document",
            sourceId: row.id,
            providerKey: "hr-credentials",
            title: `${documentKind(row.category)} expires`,
            category: "HR",
            severity: row.verificationStatus === "EXPIRED" ? "warning" : undefined,
            href: `/people/${row.employeeProfile.personProfileId}?tab=documents`,
            metadata: { sourceLabel: "Your documents", moduleKey: "hr" },
          }),
        );
      }
    }
    if (includeOwn && ownPersonId) {
      const rows = await sourceRows(input, prisma.personQualification.findMany({
        where: { parentGroupId: context.parentGroupId, personProfileId: ownPersonId, visibility: { in: SELF_QUALIFICATION_VISIBLE }, ...expiring },
        orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
        select: { id: true, type: true, verificationStatus: true, expiryDate: true },
      }));
      for (const row of rows) {
        events.push(
          onBusinessDate(input, row.expiryDate!, {
            id: `hr-credentials:qualification:${row.id}`,
            sourceType: "person_qualification",
            sourceId: row.id,
            providerKey: "hr-credentials",
            title: `${QUALIFICATION_TYPE_RULES[row.type].label} expires`,
            category: "HR",
            severity: row.verificationStatus === "EXPIRED" ? "warning" : undefined,
            href: `/people/${ownPersonId}?tab=qualifications#qualification-${row.id}`,
            metadata: { sourceLabel: "Your qualifications", moduleKey: "hr" },
          }),
        );
      }
    }

    // HR: the people it looks after, never itself this way (§74).
    if (filters.myOnly) return compact(events);
    const hrDocuments = hrLinkWhere(context);
    if (hrDocuments) {
      const members: Prisma.EmployeeDocumentLinkWhereInput = onlyMembers ? { employeeProfile: { companyMemberId: { in: onlyMembers } } } : {};
      const rows = await sourceRows(input, prisma.employeeDocumentLink.findMany({
        where: { AND: [hrDocuments, { ...expiring, employeeProfile: { employmentStatus: { not: "ENDED" } } }, members] },
        orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
        select: {
          id: true,
          category: true,
          verificationStatus: true,
          expiryDate: true,
          employeeProfileId: true,
          employeeProfile: { select: { companyMemberId: true, personProfile: { select: { firstName: true, lastName: true } } } },
        },
      }));
      for (const row of rows) {
        const name = `${row.employeeProfile.personProfile.firstName} ${row.employeeProfile.personProfile.lastName}`;
        events.push(
          onBusinessDate(input, row.expiryDate!, {
            id: `hr-credentials:document:${row.id}`,
            sourceType: "employee_document",
            sourceId: row.id,
            providerKey: "hr-credentials",
            title: `${name} — ${documentKind(row.category)} expires`,
            category: "HR",
            severity: row.verificationStatus === "EXPIRED" ? "warning" : undefined,
            href: `/hr/employees/${row.employeeProfileId}/documents?document=${row.id}`,
            participants: row.employeeProfile.companyMemberId ? [{ memberId: row.employeeProfile.companyMemberId, name }] : [],
            metadata: { sourceLabel: "Employee documents", moduleKey: "hr" },
          }),
        );
      }
    }
    const hrQualifications = hrQualificationWhere(context, ownPersonId);
    if (hrQualifications) {
      const employed: Prisma.EmployeeProfileWhereInput = { companyId: context.companyId, employmentStatus: { not: "ENDED" }, ...(onlyMembers ? { companyMemberId: { in: onlyMembers } } : {}) };
      const rows = await sourceRows(input, prisma.personQualification.findMany({
        where: { AND: [hrQualifications, { ...expiring, person: { employments: { some: employed } } }] },
        orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
        select: { id: true, type: true, verificationStatus: true, expiryDate: true, personProfileId: true, person: { select: { firstName: true, lastName: true } } },
      }));
      for (const row of rows) {
        events.push(
          onBusinessDate(input, row.expiryDate!, {
            id: `hr-credentials:qualification:${row.id}`,
            sourceType: "person_qualification",
            sourceId: row.id,
            providerKey: "hr-credentials",
            title: `${row.person.firstName} ${row.person.lastName} — ${QUALIFICATION_TYPE_RULES[row.type].label} expires`,
            category: "HR",
            severity: row.verificationStatus === "EXPIRED" ? "warning" : undefined,
            href: `/people/${row.personProfileId}?tab=qualifications#qualification-${row.id}`,
            metadata: { sourceLabel: "Qualifications", moduleKey: "hr" },
          }),
        );
      }
    }
    return compact(events);
  },
};
