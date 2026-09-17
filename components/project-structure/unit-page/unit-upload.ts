"use client";

import { structureApi } from "../structure-ui";

/**
 * A new version of a document the unit already points at (E-05D §36): the
 * Documents module's own three steps — intent, bytes straight to storage, and
 * completion — so a Sales Plan is replaced by a version, never a second file.
 */

type UploadIntent = { uploadSessionId: string; upload: { method: "PUT"; url: string; headers: Record<string, string> } };

function putObject(grant: UploadIntent["upload"], file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(grant.method, grant.url, true);
    for (const [header, value] of Object.entries(grant.headers)) request.setRequestHeader(header, value);
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      reject({ status: request.status, code: "UPLOAD_FAILED", message: request.status === 413 ? "That file is larger than the upload limit." : "The upload did not complete. Try again.", details: {} });
    });
    request.addEventListener("error", () => reject({ status: 0, code: "NETWORK", message: "The upload was interrupted. Try again.", details: {} }));
    request.send(file);
  });
}

export async function uploadNewVersion(documentId: string, file: File): Promise<{ status: string }> {
  const intent = await structureApi<UploadIntent>(`/api/documents/${documentId}/versions/upload-intent`, { body: { fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size } });
  await putObject(intent.upload, file);
  return structureApi<{ status: string }>(`/api/documents/${documentId}/versions/complete`, { body: { uploadSessionId: intent.uploadSessionId } });
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
