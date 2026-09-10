import type { Prisma } from "@prisma/client";

import { statusLabel } from "@/lib/utils/status";
import {
  buildClientScopeWhere,
  buildDocumentScopeWhere,
  buildTaskScopeWhere,
} from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { formatDate, orDash } from "@/lib/utils/format";
import type { RecordSection } from "./types";

/**
 * Tasks, Clients and Documents through the same module shell (PRD #7 §4).
 *
 * They are core entities rather than department test records, but they render
 * through the identical list/detail machinery — which is the point of the
 * shell: the business content changes, the interaction architecture does not
 * (PRD #7 §162).
 */

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "ARCHIVED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : undefined;
}

type TaskVariant = "mine" | "all" | "completed" | "archived";

function taskSection(section: string, variant: TaskVariant): RecordSection {
  return {
    module: "tasks",
    section,
    singular: "Task",
    plural: "Tasks",
    emptyTitle:
      variant === "mine"
        ? "No tasks assigned to you."
        : variant === "completed"
          ? "No completed tasks."
          : variant === "archived"
            ? "No archived tasks."
            : "No tasks yet.",
    emptyDescription:
      variant === "mine"
        ? "Work assigned to you will appear here."
        : "Tasks you can see will appear here.",
    permission: "task.view",
    approvePermission: "task.complete",
    columns: [
      { key: "title", label: "Task" },
      { key: "project", label: "Project", hideBelow: "lg" },
      { key: "assignee", label: "Assignee", hideBelow: "xl" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority", hideBelow: "lg" },
      { key: "due", label: "Due", hideBelow: "xl" },
    ],
    filters: [
      {
        param: "status",
        label: "Status",
        options: TASK_STATUSES.filter((status) => status !== "ARCHIVED").map((status) => ({
          value: status,
          label: statusLabel(status),
        })),
      },
      {
        param: "priority",
        label: "Priority",
        options: PRIORITIES.map((value) => ({ value, label: statusLabel(value) })),
      },
    ],
    async list(context, args) {
      const variantClause: Prisma.TaskWhereInput =
        variant === "mine"
          ? { assigneeMemberId: context.membershipId, archivedAt: null }
          : variant === "completed"
            ? { status: "COMPLETED", archivedAt: null }
            : variant === "archived"
              ? { archivedAt: { not: null } }
              : { archivedAt: null };

      const where: Prisma.TaskWhereInput = {
        AND: [
          buildTaskScopeWhere(context),
          variantClause,
          ...(enumValue(args.filters.status, TASK_STATUSES)
            ? [{ status: enumValue(args.filters.status, TASK_STATUSES)! }]
            : []),
          ...(enumValue(args.filters.priority, PRIORITIES)
            ? [{ priority: enumValue(args.filters.priority, PRIORITIES)! }]
            : []),
          ...(searchClause(args.search, ["title", "description"])
            ? [searchClause(args.search, ["title", "description"]) as Prisma.TaskWhereInput]
            : []),
        ],
      };

      const [rows, total] = await Promise.all([
        prisma.task.findMany({
          where,
          orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
          skip: skipFor(args.page, args.limit),
          take: args.limit,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            project: { select: { name: true } },
            assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        }),
        prisma.task.count({ where }),
      ]);

      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          primary: row.title,
          secondary: row.project?.name ?? "Personal task",
          status: row.status,
          fields: [
            { key: "title", label: "Task", value: row.title },
            {
              key: "project",
              label: "Project",
              value: row.project?.name ?? "Personal task",
              hideBelow: "lg" as const,
            },
            {
              key: "assignee",
              label: "Assignee",
              value: row.assignee
                ? `${row.assignee.user.firstName} ${row.assignee.user.lastName}`
                : "Unassigned",
              hideBelow: "xl" as const,
            },
            { key: "status", label: "Status", value: row.status, status: true },
            {
              key: "priority",
              label: "Priority",
              value: statusLabel(row.priority),
              hideBelow: "lg" as const,
            },
            {
              key: "due",
              label: "Due",
              value: row.dueDate ? formatDate(row.dueDate) : "—",
              hideBelow: "xl" as const,
            },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.task.findFirst({
        where: { AND: [buildTaskScopeWhere(context), { id }] },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { id: true, name: true } },
          assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
          creator: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.title,
        subtitle: row.project?.name ?? "Personal task",
        status: row.status,
        description: row.description,
        fields: [
          { label: "Project", value: row.project?.name ?? "Personal task" },
          {
            label: "Assignee",
            value: row.assignee
              ? `${row.assignee.user.firstName} ${row.assignee.user.lastName}`
              : "Unassigned",
          },
          { label: "Priority", value: statusLabel(row.priority) },
          { label: "Due", value: row.dueDate ? formatDate(row.dueDate) : "—" },
          {
            label: "Created by",
            value: `${row.creator.user.firstName} ${row.creator.user.lastName}`,
          },
        ],
        meta: [
          { label: "Created", value: formatDate(row.createdAt) },
          { label: "Updated", value: formatDate(row.updatedAt) },
          ...(row.completedAt
            ? [{ label: "Completed", value: formatDate(row.completedAt) }]
            : []),
        ],
      };
    },
  };
}

const CLIENT_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

function clientSection(section: string, archived: boolean): RecordSection {
  return {
    module: "clients",
    section,
    singular: "Client",
    plural: archived ? "Archived clients" : "Clients",
    emptyTitle: archived ? "No archived clients." : "No clients yet.",
    emptyDescription: "Clients your company works with will appear here.",
    permission: "client.view",
    columns: [
      { key: "name", label: "Client" },
      { key: "code", label: "Code", hideBelow: "lg" },
      { key: "type", label: "Type", hideBelow: "xl" },
      { key: "location", label: "Location", hideBelow: "xl" },
      { key: "status", label: "Status" },
    ],
    filters: archived
      ? []
      : [
          {
            param: "status",
            label: "Status",
            options: ["ACTIVE", "INACTIVE"].map((value) => ({
              value,
              label: statusLabel(value),
            })),
          },
        ],
    async list(context, args) {
      const where: Prisma.ClientWhereInput = {
        AND: [
          buildClientScopeWhere(context),
          archived ? { status: "ARCHIVED" } : { status: { not: "ARCHIVED" } },
          ...(enumValue(args.filters.status, CLIENT_STATUSES)
            ? [{ status: enumValue(args.filters.status, CLIENT_STATUSES)! }]
            : []),
          ...(searchClause(args.search, ["name", "code", "legalName", "email"])
            ? [searchClause(args.search, ["name", "code", "legalName", "email"]) as Prisma.ClientWhereInput]
            : []),
        ],
      };

      const [rows, total] = await Promise.all([
        prisma.client.findMany({
          where,
          orderBy: { name: "asc" },
          skip: skipFor(args.page, args.limit),
          take: args.limit,
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            city: true,
            country: true,
            status: true,
          },
        }),
        prisma.client.count({ where }),
      ]);

      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          primary: row.name,
          secondary: row.code ?? undefined,
          status: row.status,
          fields: [
            { key: "name", label: "Client", value: row.name },
            { key: "code", label: "Code", value: orDash(row.code), hideBelow: "lg" as const },
            {
              key: "type",
              label: "Type",
              value: statusLabel(row.type),
              hideBelow: "xl" as const,
            },
            {
              key: "location",
              label: "Location",
              value: orDash([row.city, row.country].filter(Boolean).join(", ")),
              hideBelow: "xl" as const,
            },
            { key: "status", label: "Status", value: row.status, status: true },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.client.findFirst({
        where: { AND: [buildClientScopeWhere(context), { id }] },
        select: {
          id: true,
          name: true,
          legalName: true,
          code: true,
          type: true,
          status: true,
          email: true,
          phone: true,
          website: true,
          address: true,
          city: true,
          country: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { projects: true, contacts: true } },
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.name,
        subtitle: row.code ?? undefined,
        status: row.status,
        fields: [
          { label: "Legal name", value: orDash(row.legalName) },
          { label: "Type", value: statusLabel(row.type) },
          { label: "Email", value: orDash(row.email) },
          { label: "Phone", value: orDash(row.phone) },
          {
            label: "Location",
            value: orDash([row.city, row.country].filter(Boolean).join(", ")),
          },
          { label: "Projects", value: String(row._count.projects) },
          { label: "Contacts", value: String(row._count.contacts) },
        ],
        meta: [
          { label: "Created", value: formatDate(row.createdAt) },
          { label: "Updated", value: formatDate(row.updatedAt) },
        ],
      };
    },
  };
}

const contacts: RecordSection = {
  module: "clients",
  section: "contacts",
  singular: "Contact",
  plural: "Contacts",
  emptyTitle: "No contacts yet.",
  emptyDescription: "People at your clients will appear here.",
  permission: "contact.view",
  columns: [
    { key: "name", label: "Contact" },
    { key: "client", label: "Client", hideBelow: "lg" },
    { key: "jobTitle", label: "Job title", hideBelow: "xl" },
    { key: "email", label: "Email", hideBelow: "xl" },
    { key: "status", label: "Status" },
  ],
  async list(context, args) {
    const where: Prisma.ContactWhereInput = {
      companyId: context.companyId,
      // Contacts inherit the client's own visibility (PRD #8 §35).
      client: buildClientScopeWhere(context),
      ...(args.search
        ? {
            OR: [
              { firstName: { contains: args.search, mode: "insensitive" } },
              { lastName: { contains: args.search, mode: "insensitive" } },
              { email: { contains: args.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: [{ lastName: "asc" }],
        skip: skipFor(args.page, args.limit),
        take: args.limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          email: true,
          status: true,
          client: { select: { name: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        primary: `${row.firstName} ${row.lastName}`,
        secondary: row.client.name,
        status: row.status,
        fields: [
          { key: "name", label: "Contact", value: `${row.firstName} ${row.lastName}` },
          { key: "client", label: "Client", value: row.client.name, hideBelow: "lg" as const },
          {
            key: "jobTitle",
            label: "Job title",
            value: orDash(row.jobTitle),
            hideBelow: "xl" as const,
          },
          { key: "email", label: "Email", value: orDash(row.email), hideBelow: "xl" as const },
          { key: "status", label: "Status", value: row.status, status: true },
        ],
      })),
    };
  },
  async get(context, id) {
    const row = await prisma.contact.findFirst({
      where: { companyId: context.companyId, id, client: buildClientScopeWhere(context) },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        email: true,
        phone: true,
        isPrimary: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { name: true } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      title: `${row.firstName} ${row.lastName}`,
      subtitle: row.client.name,
      status: row.status,
      fields: [
        { label: "Job title", value: orDash(row.jobTitle) },
        { label: "Email", value: orDash(row.email) },
        { label: "Phone", value: orDash(row.phone) },
        { label: "Primary contact", value: row.isPrimary ? "Yes" : "No" },
      ],
      meta: [
        { label: "Created", value: formatDate(row.createdAt) },
        { label: "Updated", value: formatDate(row.updatedAt) },
      ],
    };
  },
};

type DocumentVariant = "all" | "recent" | "archived";

function documentSection(section: string, variant: DocumentVariant): RecordSection {
  return {
    module: "documents",
    section,
    singular: "Document",
    plural: variant === "archived" ? "Archived documents" : "Documents",
    emptyTitle: variant === "archived" ? "No archived documents." : "No documents yet.",
    emptyDescription:
      "Documents filed against work you can access will appear here. A document is only visible through its parent record.",
    permission: "document.view",
    columns: [
      { key: "name", label: "Document" },
      { key: "context", label: "Context", hideBelow: "lg" },
      { key: "module", label: "Module", hideBelow: "xl" },
      { key: "created", label: "Added", hideBelow: "xl" },
      { key: "status", label: "Status" },
    ],
    async list(context, args) {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const where: Prisma.DocumentWhereInput = {
        AND: [
          buildDocumentScopeWhere(context),
          variant === "archived" ? { status: "ARCHIVED" } : { status: "ACTIVE" },
          ...(variant === "recent" ? [{ createdAt: { gte: since } }] : []),
          ...(searchClause(args.search, ["name", "fileName"])
            ? [searchClause(args.search, ["name", "fileName"]) as Prisma.DocumentWhereInput]
            : []),
        ],
      };

      const [rows, total] = await Promise.all([
        prisma.document.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: skipFor(args.page, args.limit),
          take: args.limit,
          select: {
            id: true,
            name: true,
            module: true,
            status: true,
            createdAt: true,
            project: { select: { name: true } },
            client: { select: { name: true } },
          },
        }),
        prisma.document.count({ where }),
      ]);

      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          primary: row.name,
          secondary: row.project?.name ?? row.client?.name ?? "Company document",
          status: row.status,
          fields: [
            { key: "name", label: "Document", value: row.name },
            {
              key: "context",
              label: "Context",
              value: row.project?.name ?? row.client?.name ?? "Company",
              hideBelow: "lg" as const,
            },
            {
              key: "module",
              label: "Module",
              value: orDash(row.module && statusLabel(row.module)),
              hideBelow: "xl" as const,
            },
            {
              key: "created",
              label: "Added",
              value: formatDate(row.createdAt),
              hideBelow: "xl" as const,
            },
            { key: "status", label: "Status", value: row.status, status: true },
          ],
        })),
      };
    },
    async get(context, id) {
      const row = await prisma.document.findFirst({
        where: { AND: [buildDocumentScopeWhere(context), { id }] },
        select: {
          id: true,
          name: true,
          description: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          module: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { name: true } },
          client: { select: { name: true } },
        },
      });

      if (!row) return null;

      return {
        id: row.id,
        title: row.name,
        subtitle: row.fileName ?? undefined,
        status: row.status,
        description: row.description,
        fields: [
          { label: "Project", value: orDash(row.project?.name) },
          { label: "Client", value: orDash(row.client?.name) },
          { label: "Module", value: orDash(row.module && statusLabel(row.module)) },
          { label: "Type", value: orDash(row.mimeType) },
          {
            label: "Size",
            value: row.sizeBytes ? `${Math.round(Number(row.sizeBytes) / 1024)} KB` : "—",
          },
        ],
        meta: [
          { label: "Added", value: formatDate(row.createdAt) },
          { label: "Updated", value: formatDate(row.updatedAt) },
        ],
      };
    },
  };
}

export const CORE_SECTIONS: RecordSection[] = [
  taskSection("my-tasks", "mine"),
  taskSection("all", "all"),
  taskSection("completed", "completed"),
  taskSection("archived", "archived"),
  clientSection("all", false),
  clientSection("archived", true),
  contacts,
  documentSection("all", "all"),
  documentSection("recent", "recent"),
  documentSection("archived", "archived"),
];
