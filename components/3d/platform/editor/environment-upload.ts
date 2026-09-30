"use client";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { putUploadObject } from "@/components/documents/upload-client";
import { PROJECT_3D_PLATFORM_API_ROOT } from "@/lib/3d/platform";

/**
 * Uploads a 360° backdrop photo or an IES light profile for an Experience, as
 * the Rozaris editor's Blob uploads did: the bytes go straight to the Project's
 * private 3D storage, the server checks them, and the answer is the reference
 * ("nesto-env:…") the Experience saves.
 */
export async function uploadEnvironmentAsset(projectId: string, kind: "backdrop" | "ies", file: File, onProgress?: (percent: number) => void): Promise<string> {
  const base = `${PROJECT_3D_PLATFORM_API_ROOT}/projects/${projectId}/environment-assets`;
  const intent = await engineeringApi<{ ref: string; upload: { method: string; url: string; headers: Record<string, string>; expiresAt: string } }>(base, { body: { kind, sizeBytes: file.size } });
  await putUploadObject(intent.upload as Parameters<typeof putUploadObject>[0], file, { onProgress });
  const done = await engineeringApi<{ ref: string }>(`${base}/complete`, { body: { kind, ref: intent.ref } });
  return done.ref;
}
