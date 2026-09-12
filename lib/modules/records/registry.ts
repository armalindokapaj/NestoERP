import type { Prisma } from "@prisma/client";

import { statusLabel } from "@/lib/utils/status";
import { AccessError } from "@/lib/access/guards";
import { buildProjectLinkedScopeWhere } from "@/lib/access/scope";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { formatDate, orDash } from "@/lib/utils/format";
import { CORE_SECTIONS } from "./core-sections";
import type { RecordSection } from "./types";

/**
 * The department module sections (PRD #9 §67).
 *
 * Every section is declared here: how its list is queried under the caller's
 * scope, which columns render, which filters are offered, and how a record is
 * approved. Nothing in this file bypasses scope, and every query begins at the
 * current company (PRD #7 §57).
 */


function auditMeta(record: {
  createdAt: Date;
  updatedAt?: Date;
  approvedAt?: Date | null;
}): { label: string; value: string }[] {
  const meta = [{ label: "Created", value: formatDate(record.createdAt) }];
  if (record.updatedAt) meta.push({ label: "Updated", value: formatDate(record.updatedAt) });
  if (record.approvedAt) meta.push({ label: "Approved", value: formatDate(record.approvedAt) });
  return meta;
}

function statusFilter(values: string[]) {
  return {
    param: "status",
    label: "Status",
    options: values.map((value) => ({ value, label: statusLabel(value) })),
  };
}

/** Only a value the enum actually contains reaches Prisma (PRD #8 §86). */
function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : undefined;
}

/* -------------------------------------------------------------------------- */
/* QA/QC and HSE                                                               */
/* -------------------------------------------------------------------------- */

const WORK_STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;

function qualitySection(section: string, type: "INSPECTION" | "NCR" | "PUNCH_ITEM" | "TEST" | null): RecordSection {
  const label = type ? statusLabel(type) : "Quality record";

  return {
    module: "qaqc",
    section,
    singular: label,
    plural: `${label}s`,
    emptyTitle: `No ${label.toLowerCase()} records.`,
    emptyDescription: "Quality records raised on your projects will appear here.",
    permission: "qaqc.record.view",
    approvePermission: "qaqc.record.close",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "title", label: "Title", hideBelow: "md" },
      { key: "project", label: "Project", hideBelow: "lg" },
      { key: "severity", label: "Severity", hideBelow: "xl" },
      { key: "status", label: "Status" },
    ],
    filters: [statusFilter([...WORK_STATUSES])],
    async list(context, args) {
      const where: Prisma.QualityRecordWhereInput = {
        ...buildProjectLinkedScopeWhere(context, "qaqc"),
        ...(type ? { type } : {}),
        ...(enumValue(args.filters.status, WORK_STATUSES)
          ? { status: enumValue(args.filters.status, WORK_STATUSES) }
          : {}),
        ...(searchClause(args.search, ["reference", "title"]) ?? {}),
      };

      const [rows, total] = await Promise.all([
        prisma.qualityRecord.findMany({
          where,
          orderBy: [{ status: "asc" }, { severity: "desc" }],
          skip: skipFor(args.page, args.limit),
          take: args.limit,
          select: {
            id: true,
            reference: true,
            title: true,
            severity: true,
            status: true,
            project: { select: { name: true } },
          },
        }),
        prisma.qualityRecord.count({ where }),
      ]);

      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          primary: row.reference,
          secondary: row.title,
          status: row.status,
          fields: [
            { key: "reference", label: "Reference", value: row.reference },
            { key: "title", label: "Title", value: row.title, hideBelow: "md" as const },
            { key: "project", label: "Project", value: orDash(row.project?.name), hideBelow: "lg" as const },
            {
              key: "severity",
              label: "Severity",
              value: orDash(row.severity && statusLabel(row.severity)),
              hideBelow: "xl" as const,
            },
            { key: "status", label: "Status", value: row.status, status: true },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.qualityRecord.findFirst({
        where: { ...buildProjectLinkedScopeWhere(context, "qaqc"), id },
        select: {
          id: true,
          reference: true,
          title: true,
          description: true,
          type: true,
          severity: true,
          status: true,
          dueDate: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { name: true } },
          assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.reference,
        subtitle: row.title,
        status: row.status,
        description: row.description,
        fields: [
          { label: "Type", value: statusLabel(row.type) },
          { label: "Project", value: orDash(row.project?.name) },
          { label: "Severity", value: orDash(row.severity && statusLabel(row.severity)) },
          { label: "Due", value: row.dueDate ? formatDate(row.dueDate) : "—" },
          {
            label: "Assigned to",
            value: row.assignee
              ? `${row.assignee.user.firstName} ${row.assignee.user.lastName}`
              : "—",
          },
        ],
        meta: auditMeta(row),
        approval: { status: row.status, pending: row.status !== "CLOSED" },
      };
    },
    async decide(context, id, decision) {
      await decideRecord(context, {
        module: "qaqc",
        entityType: "QualityRecord",
        id,
        decision,
        permission: "qaqc.record.close",
        find: () =>
          prisma.qualityRecord.findFirst({
            where: { ...buildProjectLinkedScopeWhere(context, "qaqc"), id },
            select: { id: true, status: true, reference: true },
          }),
        pendingStatus: null,
        apply: (tx, approved) =>
          tx.qualityRecord.update({
            where: { id },
            data: {
              status: approved ? "CLOSED" : "IN_PROGRESS",
              closedAt: approved ? new Date() : null,
              updatedBy: context.userId,
            },
          }),
        label: (record) => record.reference,
        verbs: { approve: "closed", reject: "reopened" },
      });
    },
  };
}

function hseSection(
  section: string,
  type: "INCIDENT" | "INSPECTION" | "PERMIT" | "CORRECTIVE_ACTION" | null,
): RecordSection {
  const label = type ? statusLabel(type) : "HSE record";

  return {
    module: "hse",
    section,
    singular: label,
    plural: `${label}s`,
    emptyTitle: `No ${label.toLowerCase()} records.`,
    emptyDescription: "HSE records raised on your projects will appear here.",
    permission: "hse.record.view",
    approvePermission: "hse.record.close",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "title", label: "Title", hideBelow: "md" },
      { key: "project", label: "Project", hideBelow: "lg" },
      { key: "severity", label: "Severity", hideBelow: "xl" },
      { key: "status", label: "Status" },
    ],
    filters: [statusFilter([...WORK_STATUSES])],
    async list(context, args) {
      const where: Prisma.HseRecordWhereInput = {
        ...buildProjectLinkedScopeWhere(context, "hse"),
        ...(type ? { type } : {}),
        ...(enumValue(args.filters.status, WORK_STATUSES)
          ? { status: enumValue(args.filters.status, WORK_STATUSES) }
          : {}),
        ...(searchClause(args.search, ["reference", "title"]) ?? {}),
      };

      const [rows, total] = await Promise.all([
        prisma.hseRecord.findMany({
          where,
          orderBy: [{ status: "asc" }, { severity: "desc" }],
          skip: skipFor(args.page, args.limit),
          take: args.limit,
          select: {
            id: true,
            reference: true,
            title: true,
            severity: true,
            status: true,
            project: { select: { name: true } },
          },
        }),
        prisma.hseRecord.count({ where }),
      ]);

      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          primary: row.reference,
          secondary: row.title,
          status: row.status,
          fields: [
            { key: "reference", label: "Reference", value: row.reference },
            { key: "title", label: "Title", value: row.title, hideBelow: "md" as const },
            { key: "project", label: "Project", value: orDash(row.project?.name), hideBelow: "lg" as const },
            {
              key: "severity",
              label: "Severity",
              value: orDash(row.severity && statusLabel(row.severity)),
              hideBelow: "xl" as const,
            },
            { key: "status", label: "Status", value: row.status, status: true },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.hseRecord.findFirst({
        where: { ...buildProjectLinkedScopeWhere(context, "hse"), id },
        select: {
          id: true,
          reference: true,
          title: true,
          description: true,
          type: true,
          severity: true,
          status: true,
          occurredAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { name: true } },
          assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.reference,
        subtitle: row.title,
        status: row.status,
        description: row.description,
        fields: [
          { label: "Type", value: statusLabel(row.type) },
          { label: "Project", value: orDash(row.project?.name) },
          { label: "Severity", value: orDash(row.severity && statusLabel(row.severity)) },
          { label: "Occurred", value: row.occurredAt ? formatDate(row.occurredAt) : "—" },
          {
            label: "Assigned to",
            value: row.assignee
              ? `${row.assignee.user.firstName} ${row.assignee.user.lastName}`
              : "—",
          },
        ],
        meta: auditMeta(row),
        approval: { status: row.status, pending: row.status !== "CLOSED" },
      };
    },
    async decide(context, id, decision) {
      await decideRecord(context, {
        module: "hse",
        entityType: "HseRecord",
        id,
        decision,
        permission: "hse.record.close",
        find: () =>
          prisma.hseRecord.findFirst({
            where: { ...buildProjectLinkedScopeWhere(context, "hse"), id },
            select: { id: true, status: true, reference: true },
          }),
        pendingStatus: null,
        apply: (tx, approved) =>
          tx.hseRecord.update({
            where: { id },
            data: {
              status: approved ? "CLOSED" : "IN_PROGRESS",
              closedAt: approved ? new Date() : null,
              updatedBy: context.userId,
            },
          }),
        label: (record) => record.reference,
        verbs: { approve: "closed", reject: "reopened" },
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Support                                                                     */
/* -------------------------------------------------------------------------- */

const supportRequests: RecordSection = {
  module: "support",
  section: "requests",
  singular: "Support request",
  plural: "Support requests",
  emptyTitle: "No support requests.",
  emptyDescription: "Requests raised with the platform team will appear here.",
  permission: "support.request.view",
  columns: [
    { key: "reference", label: "Reference" },
    { key: "subject", label: "Subject", hideBelow: "md" },
    { key: "requester", label: "Raised by", hideBelow: "lg" },
    { key: "status", label: "Status" },
  ],
  filters: [statusFilter(["OPEN", "IN_PROGRESS", "RESOLVED"])],
  async list(context, args) {
    const statuses = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;
    const where: Prisma.SupportRequestWhereInput = {
      companyId: context.companyId,
      ...(enumValue(args.filters.status, statuses)
        ? { status: enumValue(args.filters.status, statuses) }
        : {}),
      ...(searchClause(args.search, ["reference", "subject"]) ?? {}),
    };

    const [rows, total] = await Promise.all([
      prisma.supportRequest.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: skipFor(args.page, args.limit),
        take: args.limit,
        select: {
          id: true,
          reference: true,
          subject: true,
          status: true,
          requester: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.supportRequest.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        primary: row.reference,
        secondary: row.subject,
        status: row.status,
        fields: [
          { key: "reference", label: "Reference", value: row.reference },
          { key: "subject", label: "Subject", value: row.subject, hideBelow: "md" as const },
          {
            key: "requester",
            label: "Raised by",
            value: row.requester
              ? `${row.requester.user.firstName} ${row.requester.user.lastName}`
              : "—",
            hideBelow: "lg" as const,
          },
          { key: "status", label: "Status", value: row.status, status: true },
        ],
      })),
    };
  },
  async get(context, id) {
    const row = await prisma.supportRequest.findFirst({
      where: { companyId: context.companyId, id },
      select: {
        id: true,
        reference: true,
        subject: true,
        body: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        requester: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      title: row.reference,
      subtitle: row.subject,
      status: row.status,
      description: row.body,
      fields: [
        {
          label: "Raised by",
          value: row.requester
            ? `${row.requester.user.firstName} ${row.requester.user.lastName}`
            : "—",
        },
      ],
      meta: auditMeta(row),
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Approval shell                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The shared approval action (PRD #7 §51, §53).
 *
 * The granular `resource.approve` permission is authoritative — an access level
 * of APPROVE alone is not enough (PRD #5 §86). The decision, the audit fields
 * and the activity entry commit together.
 */
async function decideRecord<T extends { id: string; status: string }>(
  context: UserContext,
  options: {
    module: string;
    entityType: string;
    id: string;
    decision: "APPROVE" | "REJECT";
    permission: Parameters<typeof can>[1];
    find: () => Promise<T | null>;
    /** The status a record must hold to be decided; null means "any but closed". */
    pendingStatus: string | null;
    apply: (tx: Prisma.TransactionClient, approved: boolean) => Promise<unknown>;
    label: (record: T) => string;
    verbs?: { approve: string; reject: string };
  },
): Promise<void> {
  if (!can(context, options.permission)) throw new AccessError("FORBIDDEN");

  const record = await options.find();
  if (!record) throw new AccessError("NOT_FOUND");

  const approved = options.decision === "APPROVE";

  if (options.pendingStatus && record.status !== options.pendingStatus) {
    throw new AccessError("CONFLICT", "This record is no longer awaiting a decision.");
  }
  if (!options.pendingStatus && record.status === "CLOSED" && approved) {
    throw new AccessError("CONFLICT", "This record is already closed.");
  }

  const verbs = options.verbs ?? { approve: "approved", reject: "rejected" };

  await prisma.$transaction(async (tx) => {
    await options.apply(tx, approved);
    await recordActivity(tx, context, {
      module: options.module,
      entityType: options.entityType,
      entityId: record.id,
      action: approved ? "RECORD_APPROVED" : "RECORD_REJECTED",
      message: `${approved ? verbs.approve : verbs.reject} ${options.label(record)}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

const SECTIONS: RecordSection[] = [
  ...CORE_SECTIONS,
  // Finance has its own module now (PRD #15), so its sections are gone from
  // the shell registry: two implementations of "list the invoices" is one too
  // many, and the shell's was the placeholder.
  // HR has its own module now (PRD #16), so its sections are gone from the
  // shell registry — the shell's leave list had no employment record behind it.
  // Sales has its own module now (PRD #17): the shell's "opportunity" was a
  // name, a value and a stage, with no lead in front of it and no proposal
  // behind it.
  // Legal has its own module now (PRD #18): the shell's "contract" was a
  // reference, a value and an end date, with no parties, no obligations and no
  // amendment behind it.
  // Procurement has its own module now (PRD #19): the shell's "purchase order"
  // held its supplier as a free-text string and its total as a single number,
  // with no lines to price, no quote behind it and no receipt against it.
  // Inventory has its own module now (PRD #20): the shell's "item" carried its
  // own integer quantity and a free-text location, with no ledger behind the
  // number and nowhere the stock actually was.
  qualitySection("inspections", "INSPECTION"),
  qualitySection("ncrs", "NCR"),
  qualitySection("punch-lists", "PUNCH_ITEM"),
  qualitySection("tests", "TEST"),
  hseSection("incidents", "INCIDENT"),
  hseSection("inspections", "INSPECTION"),
  hseSection("permits", "PERMIT"),
  hseSection("actions", "CORRECTIVE_ACTION"),
  supportRequests,
];

const BY_KEY = new Map(SECTIONS.map((section) => [`${section.module}:${section.section}`, section]));

export function findRecordSection(moduleKey: string, section: string): RecordSection | undefined {
  return BY_KEY.get(`${moduleKey}:${section}`);
}

export function recordSectionsFor(moduleKey: string): RecordSection[] {
  return SECTIONS.filter((section) => section.module === moduleKey);
}
