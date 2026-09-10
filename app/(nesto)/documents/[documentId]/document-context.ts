import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as documents from "@/lib/modules/documents/document.service";
import type { DocumentDetailDTO } from "@/lib/modules/documents/document.types";

/**
 * Loads a document for every page under /documents/[documentId].
 *
 * A document whose parent this caller cannot reach is a 404, not a 403, so the
 * page itself cannot be used to discover that the file exists (PRD #13 §149).
 */
export async function loadDocument(
  documentId: string,
): Promise<{ context: UserContext; document: DocumentDetailDTO }> {
  const context = await requireModule("documents");

  try {
    return { context, document: await documents.getDocument(context, documentId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function documentBreadcrumbs(document: DocumentDetailDTO, trailing?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "Documents", href: "/documents" },
    trailing
      ? { label: document.name, href: `/documents/${document.id}` }
      : { label: document.name },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
