import type { Prisma } from "@prisma/client";

import { statusLabel } from "@/lib/utils/status";
import { prisma } from "@/lib/database/prisma";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { formatDate } from "@/lib/utils/format";
import { CORE_SECTIONS } from "./core-sections";
import type { RecordSection } from "./types";

/**
 * The generic record shell (PRD #9 §67).
 *
 * Every department module has now graduated to services of its own, so what is
 * left here is the platform's own support queue. The machinery stays because
 * the shell is still how a section declares its list, its columns and its
 * filters — and because it is what any future module starts on before it earns
 * a domain.
 *
 * Nothing in this file bypasses scope, and every query begins at the current
 * company (PRD #7 §57).
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
  // QA/QC has its own module now (PRD #21): the shell's "quality record" was a
  // title, a severity and a status, with no checklist behind the verdict, no
  // root cause behind the NCR and nothing that could release material to stock.
  // HSE has its own module now (PRD #22), and was the last department module on
  // the shell: its four sections were one table wearing four labels, so an
  // "incident" and a "permit" differed by an enum and nothing else — no risk
  // score to rank a hazard by, no validity window on a permit, no investigation
  // behind a closure, and no way to verify that a control had actually gone in.
  supportRequests,
];

const BY_KEY = new Map(SECTIONS.map((section) => [`${section.module}:${section.section}`, section]));

export function findRecordSection(moduleKey: string, section: string): RecordSection | undefined {
  return BY_KEY.get(`${moduleKey}:${section}`);
}

export function recordSectionsFor(moduleKey: string): RecordSection[] {
  return SECTIONS.filter((section) => section.module === moduleKey);
}
