import { prisma } from "@/lib/database/prisma";
import type { CalendarProvider } from "@/lib/modules/calendar/calendar.types";
import { compact, dateWindow, isPastDue, onBusinessDate, projectFilter, projectRef, PROJECT_SELECT, SOURCE_LIMIT, wants } from "@/lib/modules/calendar/providers/provider.helpers";
import { contractorsOpen, readableComplianceWhere } from "@/lib/modules/contractors/contractor.permissions";
import { COMPLIANCE_TYPE_LABELS } from "@/lib/modules/contractors/contractor.types";
import { engineeringOpen, readableRfiWhere, readableSubmittalWhere } from "./engineering.permissions";
import { RFI_STATUS_LABELS } from "./engineering.types";

/**
 * Engineering and contractor dates on the calendar (PRD #46 §96, §108, §200-§202).
 *
 * Only real dates: an RFI's due date while it waits for an answer, a
 * submittal's review date while it is with the reviewer, a compliance item's
 * expiry. Each is read through its record's own door, so nothing appears for a
 * project or contractor the reader cannot open, and none of them can be
 * dragged — dates change on the record.
 */

export const rfiCalendarProvider: CalendarProvider = {
  key: "rfis",
  moduleKey: "engineering",
  categories: ["ENGINEERING"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => engineeringOpen(context, "rfi.view"),
  async getEvents(input) {
    const { context, filters } = input;
    if (!wants(input, "ENGINEERING")) return [];
    const rows = await prisma.rfi.findMany({
      where: {
        AND: [
          readableRfiWhere(context),
          { status: { in: ["OPEN", "CLARIFICATION_REQUIRED"] }, dueAt: dateWindow(input) },
          projectFilter(input),
          filters.myOnly ? { assignedToMemberId: context.membershipId } : {},
          filters.memberIds?.length ? { assignedToMemberId: { in: filters.memberIds } } : {},
        ],
      },
      orderBy: { dueAt: "asc" },
      take: SOURCE_LIMIT,
      select: { id: true, rfiNumber: true, subject: true, status: true, priority: true, dueAt: true, projectId: true, project: PROJECT_SELECT },
    });
    return compact(
      rows.map((row) => {
        const late = isPastDue(row.dueAt!, input);
        return onBusinessDate(input, row.dueAt!, {
          id: `rfis:${row.id}`,
          sourceType: "rfi",
          sourceId: row.id,
          providerKey: "rfis",
          title: `RFI ${row.rfiNumber} due`,
          subtitle: row.subject,
          category: "ENGINEERING",
          status: RFI_STATUS_LABELS[row.status],
          priority: row.priority === "CRITICAL" ? "CRITICAL" : row.priority === "HIGH" ? "HIGH" : "NORMAL",
          severity: late ? "warning" : undefined,
          project: projectRef(row.project),
          href: `/projects/${row.projectId}/engineering/rfis/${row.id}`,
          metadata: { sourceLabel: "RFI response due", moduleKey: "engineering" },
        });
      }),
    );
  },
};

export const submittalCalendarProvider: CalendarProvider = {
  key: "submittals",
  moduleKey: "engineering",
  categories: ["ENGINEERING"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => engineeringOpen(context, "submittal.view"),
  async getEvents(input) {
    const { context, filters } = input;
    if (!wants(input, "ENGINEERING")) return [];
    const rows = await prisma.technicalSubmittal.findMany({
      where: {
        AND: [
          readableSubmittalWhere(context),
          { status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, dueAt: dateWindow(input) },
          projectFilter(input),
          filters.myOnly ? { assignedReviewerMemberId: context.membershipId } : {},
          filters.memberIds?.length ? { assignedReviewerMemberId: { in: filters.memberIds } } : {},
        ],
      },
      orderBy: { dueAt: "asc" },
      take: SOURCE_LIMIT,
      select: { id: true, submittalNumber: true, title: true, dueAt: true, projectId: true, project: PROJECT_SELECT },
    });
    return compact(
      rows.map((row) =>
        onBusinessDate(input, row.dueAt!, {
          id: `submittals:${row.id}`,
          sourceType: "technical_submittal",
          sourceId: row.id,
          providerKey: "submittals",
          title: `Review due: ${row.submittalNumber}`,
          subtitle: row.title,
          category: "ENGINEERING",
          priority: "NORMAL",
          severity: isPastDue(row.dueAt!, input) ? "warning" : undefined,
          project: projectRef(row.project),
          href: `/projects/${row.projectId}/engineering/submittals/${row.id}`,
          metadata: { sourceLabel: "Submittal review due", moduleKey: "engineering" },
        }),
      ),
    );
  },
};

export const complianceCalendarProvider: CalendarProvider = {
  key: "contractor-compliance",
  moduleKey: "contractors",
  categories: ["LEGAL"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => contractorsOpen(context, "contractor_compliance.view"),
  async getEvents(input) {
    const { context, filters } = input;
    // Company-level dates: no project, nobody's personal schedule.
    if (!wants(input, "LEGAL") || filters.myOnly || filters.memberIds?.length || filters.projectIds?.length) return [];
    const rows = await prisma.contractorComplianceItem.findMany({
      where: { AND: [readableComplianceWhere(context), { archivedAt: null, status: { notIn: ["WAIVED", "ARCHIVED"] }, expiresAt: dateWindow(input) }] },
      orderBy: { expiresAt: "asc" },
      take: SOURCE_LIMIT,
      select: { id: true, title: true, type: true, status: true, expiresAt: true, contractorId: true, contractor: { select: { legalName: true } } },
    });
    return compact(
      rows.map((row) =>
        onBusinessDate(input, row.expiresAt!, {
          id: `contractor-compliance:${row.id}`,
          sourceType: "contractor_compliance",
          sourceId: row.id,
          providerKey: "contractor-compliance",
          title: `${row.title} expires`,
          subtitle: `${row.contractor.legalName} · ${COMPLIANCE_TYPE_LABELS[row.type]}`,
          category: "LEGAL",
          priority: row.status === "EXPIRED" ? "HIGH" : "NORMAL",
          severity: row.status === "EXPIRED" ? "warning" : undefined,
          href: `/contractors/${row.contractorId}/compliance?item=${row.id}`,
          metadata: { sourceLabel: "Contractor compliance", moduleKey: "contractors" },
        }),
      ),
    );
  },
};
