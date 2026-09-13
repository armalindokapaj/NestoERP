import Link from "next/link";
import { Files } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { recordDefinition } from "@/lib/core/records/record.registry";
import { canAttachToDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";

/**
 * The documents section of a business record (PRD #38 §52, §55).
 *
 * One component for every record type the registry lets documents hang off.
 * What it lists, whether it offers "Add document", and where that upload
 * returns are all read from the same registry entry the upload service
 * authorises against — so a page can no longer advertise an upload the service
 * would refuse, which is exactly how HSE, QA/QC, inventory, Sales and Legal
 * pages used to fail.
 *
 * `canAttach` lets a page withhold uploads for its own reasons (a record in a
 * state that takes no more files); it can only narrow, never widen.
 */
export async function RecordDocuments({
  context,
  entityType,
  entityId,
  canAttach = true,
  emptyTitle = "No documents on file.",
  emptyDescription = "Files attached to this record appear here.",
}: {
  context: UserContext;
  entityType: string;
  entityId: string;
  canAttach?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const definition = recordDefinition(entityType);
  if (!definition?.documents) return null;

  const [result, attachable] = await Promise.all([
    documents.listDocuments(
      context,
      documentListQuerySchema.parse({ entityType: definition.type, entityId, limit: 100 }),
    ),
    canAttach
      ? canAttachToDocumentParent(context, {
          projectId: null,
          clientId: null,
          module: definition.moduleKey,
          entityType: definition.type,
          entityId,
        })
      : Promise.resolve(false),
  ]);

  const uploadHref = `/documents/new?entityType=${encodeURIComponent(definition.type)}&entityId=${encodeURIComponent(entityId)}`;

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title={emptyTitle}
        description={emptyDescription}
        action={attachable ? { label: "Add document", href: uploadHref } : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {attachable ? (
        <div className="flex justify-end">
          <Button asChild size="sm">
            <Link href={uploadHref}>Add document</Link>
          </Button>
        </div>
      ) : null}
      <DocumentTable documents={result.data} />
    </div>
  );
}
