"use server";

import { revalidatePath } from "next/cache";

import { AccessError } from "@/lib/access/guards";
import { requireCompanyContext } from "@/lib/context/current-user";
import { committed } from "@/lib/forms/committed";
import { updateDocumentSchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";

/**
 * Server actions for the Documents module (PRD #13 §131).
 *
 * A thin shell over the same service the API routes call — the authorisation,
 * validation, storage coordination and activity logic exists once.
 */

/**
 * An upload or archive changes what /documents, the project's Documents tab and
 * the client's each contain, so the affected subtrees are revalidated rather
 * than one path (PRD #13 §223).
 */
function revalidateDocuments(documentId?: string, projectId?: string | null, clientId?: string | null) {
  revalidatePath("/documents", "layout");
  if (documentId) revalidatePath(`/documents/${documentId}`, "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
  if (clientId) revalidatePath(`/clients/${clientId}`, "layout");
  revalidatePath("/dashboard");
}

export type DocumentActionResult =
  | { ok: true; redirectTo?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function toResult(error: unknown): DocumentActionResult {
  if (error instanceof AccessError) return { ok: false, error: error.message };
  // Never surface a storage or database error to a person (PRD #13 §190).
  console.error("[documents] action failed", error);
  return { ok: false, error: "The file was not saved. Try again." };
}

function textValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function updateDocumentAction(
  documentId: string,
  formData: FormData,
): Promise<DocumentActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateDocumentSchema.safeParse(textValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await documents.updateDocument(context, documentId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateDocuments(documentId);
  // The form navigates, so Save and continue can go where the person was going (AUD-03 §6).
  return committed(`/documents/${documentId}`);
}

export async function archiveDocumentAction(documentId: string): Promise<DocumentActionResult> {
  const context = await requireCompanyContext();
  try {
    await documents.archiveDocument(context, documentId);
  } catch (error) {
    return toResult(error);
  }
  revalidateDocuments(documentId);
  return { ok: true };
}

export async function restoreDocumentAction(documentId: string): Promise<DocumentActionResult> {
  const context = await requireCompanyContext();
  try {
    await documents.restoreDocument(context, documentId);
  } catch (error) {
    return toResult(error);
  }
  revalidateDocuments(documentId);
  return { ok: true };
}
