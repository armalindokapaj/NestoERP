import { can, canAccessModule } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { recordDefinition } from "@/lib/core/records/record.registry";
import { formatFileSize, isPreviewable } from "@/lib/modules/documents/document.files";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import type { UnifiedApprovalDocumentRef } from "./approvals.types";

/**
 * Supporting documents for an approval (PRD #41 §59-§61, §178-§180, §247).
 *
 * The record's own files, listed by the canonical Document service in the
 * reader's own context — the same answer the record's Documents tab gives.
 * Being able to decide an approval grants nothing here: a Finance approver
 * without document access sees that files exist on the record page, not what
 * they are.
 */
export async function approvalDocuments(
  context: UserContext,
  recordType: string,
  recordId: string,
): Promise<{ available: boolean; documents: UnifiedApprovalDocumentRef[] }> {
  const definition = recordDefinition(recordType);
  if (!definition?.documents) return { available: false, documents: [] };

  const capability = definition.documents;
  const mayRead =
    canAccessModule(context, "documents") &&
    can(context, "document.view") &&
    (capability.view.every((permission) => can(context, permission)) ||
      Boolean(capability.self && can(context, capability.self.permission) && capability.self.isSelf(context, recordId)));
  if (!mayRead) return { available: false, documents: [] };

  const result = await documents.listDocuments(
    context,
    documentListQuerySchema.parse({ entityType: definition.type, entityId: recordId, limit: 50 }),
  );
  return {
    available: true,
    documents: result.data.map((row) => ({
      id: row.id,
      name: row.name,
      fileName: row.originalFileName,
      extension: row.extension,
      sizeLabel: row.sizeBytes ? formatFileSize(row.sizeBytes) : null,
      versionNumber: null,
      uploadedAt: row.createdAt,
      href: `/documents/${row.id}`,
      previewable: row.storageStatus === "AVAILABLE" && isPreviewable(row.extension),
    })),
  };
}
