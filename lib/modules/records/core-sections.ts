import type { Prisma } from "@prisma/client";

import { statusLabel } from "@/lib/utils/status";
import { buildDocumentScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { formatDate, orDash } from "@/lib/utils/format";
import type { RecordSection } from "./types";

/**
 * Documents through the same module shell (PRD #7 §4).
 *
 * Documents is a core entity rather than a department test record, but it
 * renders through the identical list/detail machinery — which is the point of
 * the shell: the business content changes, the interaction architecture does
 * not (PRD #7 §162).
 *
 * Tasks (PRD #11) and Clients (PRD #12) used to live here too. Each now has its
 * own service, API and pages, so neither is a generic record section any more.
 */

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
  documentSection("all", "all"),
  documentSection("recent", "recent"),
  documentSection("archived", "archived"),
];
