/**
 * DocumentService (MOB-07 §72, §105): the one place the browser asks NESTO how
 * to reach a document's bytes.
 *
 * `resolveAccess` returns a short-lived grant from the authenticated preview or
 * download route; it is the access decision, made at the moment of the call with
 * the caller's current permissions. Viewers consume the grant and nothing else —
 * they never build a storage path, so a different storage provider (OneDrive,
 * SharePoint) only changes what the server hands back (§70-§72).
 */

export type AccessPurpose = "preview" | "download";

export type ResolvedAccess = {
  url: string;
  mimeType: string;
  kind: "pdf" | "image" | "file";
  expiresAt: string | null;
};

export class AccessError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "AccessError";
    this.code = code;
    this.status = status;
  }
}

export async function resolveAccess(documentId: string, purpose: AccessPurpose = "preview"): Promise<ResolvedAccess> {
  let response: Response;
  try {
    response = await fetch(`/api/documents/${documentId}/${purpose}`, { method: "POST" });
  } catch {
    throw new AccessError("The connection dropped. Check it and try again.", "NETWORK", 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new AccessError(body?.error?.message ?? "This file cannot be opened.", body?.error?.code ?? "ACCESS_DENIED", response.status);
  }
  const grant = (await response.json()) as { url: string; mimeType: string; kind?: "pdf" | "image"; expiresAt?: string };
  const kind = grant.kind ?? (grant.mimeType === "application/pdf" ? "pdf" : grant.mimeType.startsWith("image/") ? "image" : "file");
  return { url: grant.url, mimeType: grant.mimeType, kind, expiresAt: grant.expiresAt ?? null };
}

/** The kind a viewer can show for a file, from what the list already knows (no request). */
export function viewerKindFor(mimeType: string | null | undefined, extension?: string | null): "pdf" | "image" | null {
  const mime = (mimeType ?? "").toLowerCase();
  const ext = (extension ?? "").toLowerCase().replace(/^\./, "");
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  return null;
}
