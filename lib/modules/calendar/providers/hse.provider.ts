import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import {
  buildActionScopeWhere,
  buildInspectionScopeWhere,
  buildPermitScopeWhere,
  buildRiskAssessmentScopeWhere,
  buildToolboxScopeWhere,
} from "@/lib/modules/hse/hse.scope";
import { addLocalDays, businessDate } from "../calendar.time";
import type { CalendarEventDTO, CalendarProvider } from "../calendar.types";
import { compact, dateWindow, isPastDue, moduleOpen, onBusinessDate, projectFilter, projectRef, PROJECT_SELECT, SOURCE_LIMIT, todayIn } from "./provider.helpers";

/**
 * Safety dates (PRD #39 §60): scheduled inspections, toolbox talks, permit
 * expiries, risk-assessment reviews and HSE action due dates.
 *
 * HSE is neutral on the calendar by default. Only a real severity is coloured:
 * an active permit expiring within three days is a warning, one already past
 * its validity a critical — an ordinary inspection is not (PRD #39 §153).
 */
export const hseProvider: CalendarProvider = {
  key: "hse",
  moduleKey: "hse",
  categories: ["HSE"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) =>
    ["hse.inspection.view", "hse.toolbox.view", "hse.permit.view", "hse.risk.view", "hse.action.view"].some((permission) =>
      moduleOpen(context, "hse", permission as Parameters<typeof moduleOpen>[2]),
    ),
  async getEvents(input) {
    const { context, filters } = input;
    const window = dateWindow(input);
    const mine = filters.myOnly;
    const events: Array<CalendarEventDTO | null> = [];
    const base = (id: string, sourceType: string, href: string, label: string) => ({
      id,
      sourceType,
      sourceId: id.split(":").at(-1)!,
      providerKey: "hse",
      category: "HSE" as const,
      href,
      metadata: { sourceLabel: label, moduleKey: "hse" },
    });

    if (can(context, "hse.inspection.view")) {
      const rows = await prisma.hseInspection.findMany({
        where: {
          AND: [
            buildInspectionScopeWhere(context),
            { scheduledDate: window, status: { in: ["DRAFT", "SCHEDULED", "IN_PROGRESS"] } },
            projectFilter(input),
            mine ? { assignedInspectorMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, inspectionNumber: true, inspectionType: true, status: true, scheduledDate: true, project: PROJECT_SELECT },
      });
      for (const row of rows) {
        events.push(onBusinessDate(input, row.scheduledDate!, {
          ...base(`hse:inspection:${row.id}`, "hse_inspection", `/hse/inspections/${row.id}`, "HSE inspection"),
          title: `HSE inspection ${row.inspectionNumber}`,
          subtitle: String(row.inspectionType).replaceAll("_", " ").toLowerCase(),
          status: row.status,
          project: projectRef(row.project),
        }));
      }
    }

    if (can(context, "hse.toolbox.view")) {
      const rows = await prisma.toolboxTalk.findMany({
        where: {
          AND: [
            buildToolboxScopeWhere(context),
            { talkDate: window, status: { not: "CANCELLED" } },
            projectFilter(input),
            mine ? { conductedByMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, talkNumber: true, title: true, status: true, talkDate: true, project: PROJECT_SELECT },
      });
      for (const row of rows) {
        events.push(onBusinessDate(input, row.talkDate, {
          ...base(`hse:toolbox:${row.id}`, "toolbox_talk", `/hse/toolbox-talks/${row.id}`, "Toolbox talk"),
          title: `Toolbox talk: ${row.title}`,
          subtitle: row.talkNumber,
          status: row.status,
          project: projectRef(row.project),
        }));
      }
    }

    if (can(context, "hse.permit.view")) {
      const rows = await prisma.hseWorkPermit.findMany({
        where: {
          AND: [
            buildPermitScopeWhere(context),
            { validUntil: window, status: { in: ["APPROVED", "ACTIVE", "SUSPENDED"] } },
            projectFilter(input),
            mine ? { OR: [{ requestedByMemberId: context.membershipId }, { responsibleMemberId: context.membershipId }] } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, permitNumber: true, title: true, status: true, validUntil: true, project: PROJECT_SELECT },
      });
      const today = todayIn(input.timezone);
      for (const row of rows) {
        const expiry = businessDate(row.validUntil!);
        const severity = row.status === "ACTIVE" ? (expiry < today ? "critical" : expiry <= addLocalDays(today, 3) ? "warning" : undefined) : undefined;
        events.push(onBusinessDate(input, row.validUntil!, {
          ...base(`hse:permit:${row.id}`, "work_permit", `/hse/permits/${row.id}`, "Work permit"),
          title: `Permit ${row.permitNumber} expires`,
          subtitle: row.title,
          status: row.status,
          priority: severity === "critical" ? "CRITICAL" : severity ? "HIGH" : undefined,
          severity,
          project: projectRef(row.project),
        }));
      }
    }

    if (can(context, "hse.risk.view")) {
      const rows = await prisma.hseRiskAssessment.findMany({
        where: {
          AND: [
            buildRiskAssessmentScopeWhere(context),
            { reviewDate: window, status: { in: ["APPROVED", "PENDING_APPROVAL"] } },
            projectFilter(input),
            mine ? { ownerMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, assessmentNumber: true, title: true, status: true, reviewDate: true, project: PROJECT_SELECT },
      });
      for (const row of rows) {
        events.push(onBusinessDate(input, row.reviewDate!, {
          ...base(`hse:risk:${row.id}`, "risk_assessment", `/hse/risk-assessments/${row.id}`, "Risk assessment"),
          title: `Risk review: ${row.title}`,
          subtitle: row.assessmentNumber,
          status: row.status,
          project: projectRef(row.project),
        }));
      }
    }

    if (can(context, "hse.action.view")) {
      const rows = await prisma.hseAction.findMany({
        where: {
          AND: [
            buildActionScopeWhere(context),
            { dueDate: window, status: { in: ["OPEN", "IN_PROGRESS", "REJECTED", "REOPENED", "PENDING_VERIFICATION"] } },
            projectFilter(input),
            mine ? { assignedToMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, actionNumber: true, title: true, status: true, priority: true, dueDate: true, project: PROJECT_SELECT },
      });
      for (const row of rows) {
        const overdue = row.status !== "PENDING_VERIFICATION" && isPastDue(row.dueDate!, input);
        events.push(onBusinessDate(input, row.dueDate!, {
          ...base(`hse:action:${row.id}`, "hse_action", `/hse/actions/${row.id}`, "HSE action"),
          title: `${row.actionNumber} due`,
          subtitle: row.title,
          status: overdue ? "OVERDUE" : row.status,
          priority: row.priority === "CRITICAL" ? "CRITICAL" : row.priority === "HIGH" ? "HIGH" : "NORMAL",
          severity: overdue ? (row.priority === "CRITICAL" ? "critical" : "warning") : undefined,
          project: projectRef(row.project),
        }));
      }
    }

    return compact(events);
  },
};
