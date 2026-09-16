import type { UserContext } from "@/lib/context/types";
import { assertModule, assertPermission } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { StorageError } from "@/lib/core/storage";
import * as repository from "../document.repository";

/**
 * Storage authorization (PRD #29 §3, §99, §324).
 *
 * Every file operation runs the same sequence, in the same order, from one
 * place:
 *
 *   documents module enabled
 *   + document permission
 *   + parent module permission        }  both inside the scoped lookup
 *   + parent record access            }  below, which is where the real work is
 *   + company isolation
 *   + storage object state
 *
 * The reason this is a service rather than a comment in three route handlers
 * is §4: knowing a document id, a storage key or a file name must never be
 * enough. There is exactly one door and it is this one.
 */

const MODULE = "documents" as const;

export type AccessibleDocument = repository.DocumentDetailRow;

/**
 * Finds a document this caller may see, or refuses.
 *
 * "Not found" for everything — out of scope, another company, parent module
 * disabled — because any other answer confirms the document exists
 * (PRD #29 §160, §361).
 */
export async function requireDocument(
  context: UserContext,
  documentId: string,
): Promise<AccessibleDocument> {
  assertModule(context, MODULE);
  assertPermission(context, "document.view");

  const document = await repository.findDocumentInScope(context, documentId);
  if (!document) throw new StorageError("DOCUMENT_NOT_FOUND");
  return document;
}

/**
 * The download gate (PRD #29 §99, §296).
 *
 * The uploader gets no special treatment. Somebody who put a file on a project
 * they have since left cannot download it, because access follows the current
 * role and scope rather than authorship (PRD #29 §299, §300).
 */
export async function requireDownloadableDocument(
  context: UserContext,
  documentId: string,
): Promise<AccessibleDocument> {
  const document = await requireDocument(context, documentId);
  assertPermission(context, "document.download");
  assertObjectReadable(document);
  return document;
}

/**
 * Refuses a document whose object is not in a readable state.
 *
 * Each state gets its own answer, because "processing" and "rejected" mean
 * different things to whoever is waiting (PRD #29 §162-§165).
 */
export function assertObjectReadable(document: AccessibleDocument): void {
  switch (document.storageStatus) {
    case "AVAILABLE":
      if (!document.storageKey) throw new StorageError("STORAGE_OBJECT_MISSING");
      return;
    case "PENDING_UPLOAD":
    case "UPLOADED":
    case "VERIFYING":
      throw new StorageError("DOCUMENT_NOT_AVAILABLE");
    case "SCANNING":
      throw new StorageError("FILE_SCAN_PENDING");
    case "REJECTED":
      // The reason code is on the row for the UI; the message stays generic so
      // a scanner's opinion is not restated to the uploader (PRD #29 §211).
      throw new StorageError(
        document.rejectionReason === "FILE_REJECTED_MALWARE"
          ? "FILE_REJECTED_MALWARE"
          : "DOCUMENT_NOT_AVAILABLE",
      );
    case "FAILED":
      // A scanner that never gave a verdict is not a file that never arrived (PRD #51 §35).
      throw new StorageError(document.rejectionReason === "FILE_SCAN_FAILED" ? "FILE_SCAN_FAILED" : "STORAGE_OBJECT_MISSING");
    case "ARCHIVED":
      throw new StorageError("DOCUMENT_ARCHIVED");
  }
}

/** Whether this caller may abort or retry somebody's upload (PRD #29 §207). */
export function canManageUpload(
  context: UserContext,
  session: { memberId: string },
): boolean {
  if (session.memberId === context.membershipId) return true;
  return can(context, "document.archive");
}
