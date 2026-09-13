import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import type { CalendarProvider } from "../calendar.types";
import { compact, dateWindow, isPastDue, moduleOpen, onBusinessDate, SOURCE_LIMIT } from "./provider.helpers";

/**
 * Document review deadlines (PRD #39 §61). A pending review with a due date
 * appears for the reviewer and for whoever asked — never for the company at
 * large — and only while the document itself is readable to them.
 */
export const documentProvider: CalendarProvider = {
  key: "documents",
  moduleKey: "documents",
  categories: ["DOCUMENT"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => moduleOpen(context, "documents", "document.view"),
  async getEvents(input) {
    const { context } = input;
    const readable = await buildDocumentAccessWhere(context);
    const reviews = await prisma.documentReview.findMany({
      where: {
        companyId: context.companyId,
        status: "PENDING",
        dueAt: dateWindow(input),
        OR: [{ reviewerMemberId: context.membershipId }, { requestedByMemberId: context.membershipId }],
      },
      take: SOURCE_LIMIT,
      select: { id: true, documentId: true, dueAt: true, reviewerMemberId: true, version: { select: { versionNumber: true } } },
    });
    if (reviews.length === 0) return [];

    const documents = await prisma.document.findMany({
      where: { AND: [readable, { id: { in: [...new Set(reviews.map((row) => row.documentId))] } }] },
      select: { id: true, name: true, project: { select: { id: true, name: true, code: true } } },
    });
    const byId = new Map(documents.map((row) => [row.id, row]));

    return compact(
      reviews.map((row) => {
        const document = byId.get(row.documentId);
        if (!document) return null;
        const reviewing = row.reviewerMemberId === context.membershipId;
        const overdue = isPastDue(row.dueAt!, input);
        return onBusinessDate(input, row.dueAt!, {
          id: `documents:review:${row.id}`,
          sourceType: "document_review",
          sourceId: row.id,
          providerKey: "documents",
          title: reviewing ? `Review due: ${document.name}` : `Awaiting review: ${document.name}`,
          subtitle: `Version ${row.version.versionNumber}`,
          category: "DOCUMENT",
          status: overdue ? "OVERDUE" : "PENDING",
          severity: overdue ? "warning" : undefined,
          project: document.project ?? undefined,
          href: `/documents/${document.id}`,
          metadata: { sourceLabel: "Document review", moduleKey: "documents" },
        });
      }),
    );
  },
};
