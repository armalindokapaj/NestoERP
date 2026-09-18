"use client";

import type { ApiFailure } from "@/components/engineering/engineering-api";

/**
 * Putting a file on an employee's record (E-02 §54, §117): the Documents
 * module's own three steps — authorise, bytes straight to storage, completion —
 * with the employment as the file's parent. There is no employee file store of
 * its own. The promise settles once the server says the file is checked and
 * available, because only then can it be filed (§197).
 */

type Grant = { documentId: string; uploadSessionId: string; upload: { method: "PUT"; url: string; headers: Record<string, string> } };

function fail(message: string, code = "UPLOAD_FAILED", status = 0): ApiFailure {
  return { status, code, message, details: {} };
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw fail("Check your connection and try again.", "NETWORK");
  }
  const json = (await response.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
  if (!response.ok) throw { status: response.status, code: json?.error?.code ?? "UPLOAD_FAILED", message: json?.error?.message ?? "The file could not be uploaded.", details: json?.error?.details ?? {} } satisfies ApiFailure;
  return (json?.data ?? json) as T;
}

function put(grant: Grant["upload"], file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(grant.method, grant.url, true);
    for (const [header, value] of Object.entries(grant.headers)) request.setRequestHeader(header, value);
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      reject(fail(request.status === 413 ? "That file is larger than the upload limit." : "The upload did not complete. Try again.", "UPLOAD_FAILED", request.status));
    });
    request.addEventListener("error", () => reject(fail("The upload was interrupted. Try again.", "NETWORK")));
    request.send(file);
  });
}

/** Waits for the scan to settle, a minute and a half at most, then gives the file back to the maintenance worker (§197). */
async function settled(documentId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const status = await call<{ status: string; message?: string | null }>(`/api/documents/${documentId}/storage-status`, { method: "GET" });
    if (status.status === "AVAILABLE") return;
    if (status.status === "REJECTED" || status.status === "FAILED") throw fail(status.message ?? "The file was not accepted.", "FILE_REJECTED");
  }
  throw fail("The file is still being checked. File it from the list once it is ready.", "FILE_PENDING");
}

/** Uploads a file onto an employment and resolves with its canonical document id once it is available. */
export async function uploadToEmployment(employmentId: string, file: File, name: string): Promise<string> {
  const grant = await call<Grant>("/api/documents/uploads", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": `${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}:${employmentId}` },
    body: JSON.stringify({ context: "record", entityType: "employee", entityId: employmentId, name, fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size }),
  });
  await put(grant.upload, file);
  const done = await call<{ documentId: string; status: string }>(`/api/documents/uploads/${grant.uploadSessionId}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (done.status !== "AVAILABLE") await settled(grant.documentId);
  return grant.documentId;
}

/** A new version of a file already filed (§61): the same logical document, never a second one (§189). */
export async function uploadNewVersion(documentId: string, file: File): Promise<void> {
  const intent = await call<{ uploadSessionId: string; upload: Grant["upload"] }>(`/api/documents/${documentId}/versions/upload-intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size }),
  });
  await put(intent.upload, file);
  await call(`/api/documents/${documentId}/versions/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadSessionId: intent.uploadSessionId }) });
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
