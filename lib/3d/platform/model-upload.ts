/** The product ceiling for one GLB. A deployment's storage may take less (`uploadLimitBytes`). */
export const MAX_MODEL_BYTES = 200 * 1024 * 1024;

export type ModelUploadIntent = {
  versionId: string;
  upload: { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string };
};

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * Checks a chosen file before anything is created: the name, the size against
 * this deployment's limit, and the 12-byte GLB header. Only the header is read,
 * so a large model is never buffered on the UI thread.
 */
export async function checkModelFile(file: File, limitBytes: number = MAX_MODEL_BYTES): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".glb")) throw new Error("Choose a binary .glb model. Export other formats (FBX, OBJ, glTF, Revit) as GLB first.");
  if (file.name.length > 240) throw new Error("Shorten the file name to 240 characters or fewer.");
  if (file.size > limitBytes) {
    throw new Error(`This model is ${formatMegabytes(file.size)}; this deployment accepts GLB files up to ${formatMegabytes(limitBytes)}. Compress it (Draco or Meshopt, for example with gltf-transform) or split it into several models.`);
  }
  if (file.size < 20) throw new Error("This file is empty or is not a valid GLB model.");
  const view = new DataView(await file.slice(0, 12).arrayBuffer());
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== file.size) {
    throw new Error("The file is not a complete GLB 2.0 model. Export it again and retry.");
  }
}

/** What an object store's refusal means, from its status and body (S3, Supabase, or the local route). */
function refusal(status: number, body: string): "exists" | "too-large" | "expired" | "other" {
  let code = "";
  try {
    const parsed = JSON.parse(body) as { statusCode?: string; code?: string; error?: string };
    code = `${parsed.statusCode ?? ""} ${parsed.code ?? ""} ${parsed.error ?? ""}`;
  } catch {
    code = body.slice(0, 200);
  }
  // A retry after a lost response: the immutable key already holds the bytes, and /complete verifies them.
  if (status === 412 || status === 409 || /\b409\b|KeyAlreadyExists|Duplicate|PreconditionFailed/.test(code)) return "exists";
  if (status === 413 || /\b413\b|EntityTooLarge|Payload too large/i.test(code)) return "too-large";
  if (/InvalidJWT|jwt expired|ExpiredToken|Request has expired/i.test(code)) return "expired";
  return "other";
}

/**
 * Sends the file straight to the private storage grant — never through the
 * app server, never as base64 — and reports measured progress.
 */
export function putModelFile(intent: ModelUploadIntent, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(intent.upload.method, intent.upload.url);
    xhr.timeout = 14 * 60 * 1000;
    for (const [name, value] of Object.entries(intent.upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const kind = refusal(xhr.status, typeof xhr.responseText === "string" ? xhr.responseText : "");
      if (kind === "exists") return resolve();
      reject(new Error(
        kind === "too-large" ? "Storage refused the file size. Compress the model or split it, then choose it again."
          : kind === "expired" ? "This upload grant expired. Choose the file again to start a new version."
            : `Storage refused the upload (${xhr.status}). Retry; if it keeps failing, an administrator should check the storage configuration.`,
      ));
    };
    xhr.onerror = () => reject(new Error("Could not reach model storage. Check your connection and retry; if it keeps failing, an administrator should check the storage CORS settings."));
    xhr.ontimeout = () => reject(new Error("The upload timed out. Retry while its upload grant is still valid."));
    xhr.onabort = () => reject(new Error("The upload was interrupted. Retry to send it again."));
    xhr.send(file);
  });
}
