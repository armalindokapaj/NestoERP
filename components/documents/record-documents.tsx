import Link from "next/link";
import { Files } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can, canAccessModule } from "@/lib/access/can";
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
  title,
}: {
  context: UserContext;
  entityType: string;
  entityId: string;
  canAttach?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Renders the section with its own heading, and nothing at all when the reader cannot see files here. */
  title?: string;
}) {
  const definition = recordDefinition(entityType);
  if (!definition?.documents) return null;

  // Nothing to show rather than a failed request: the reader needs Documents,
  // `document.view`, and the record type's own document permissions (or the
  // self-service door where the record type has one).
  const capability = definition.documents;
  const mayRead =
    canAccessModule(context, "documents") &&
    can(context, "document.view") &&
    (capability.view.every((permission) => can(context, permission)) ||
      Boolean(capability.self && can(context, capability.self.permission) && (await capability.self.isSelf(context, entityId))));
  if (!mayRead) return null;

  if (title) {
    return (
      <section className="space-y-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <RecordDocuments
          context={context}
          entityType={entityType}
          entityId={entityId}
          canAttach={canAttach}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        />
      </section>
    );
  }

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
