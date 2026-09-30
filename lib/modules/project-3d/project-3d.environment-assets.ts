import { prisma } from "@/lib/database/prisma";
import { AccessError, assertFound } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { ENVIRONMENT_FILE_PATTERN, ENVIRONMENT_REF_PREFIX, environmentRefFile, referencedEnvironmentFiles, type EnvironmentFields } from "@/lib/3d/shared/environment-refs";
import { project3DReleaseManifestSchema } from "@/lib/3d/shared/release.schema";
import type { UserContext } from "@/lib/context/types";

import { hasActiveProject3DViewer } from "./project-3d.viewer";

import { assertProject3DStorageKey, buildProject3DStorageKey } from "./project-3d.storage";

/*
 * Files an Experience's environment uses, uploaded in the editor as in the
 * Rozaris Web3D editor: the 360° backdrop photo (Sun & Sky) and IES light
 * profiles (Artificial lights). Rozaris puts them on public Blob storage; here
 * they stay private in the Project's 3D storage, and the Experience keeps a
 * reference ("nesto-env:<file>") that each audience turns into its own address:
 *
 * - the editor reads any of the Project's files, behind platform.3d.view;
 * - the signed-in company viewer reads only files its published release uses,
 *   behind the same checks as the viewer page;
 * - the public viewer never receives them (public-experience.ts withholds both).
 */

const KINDS = {
  backdrop: { extension: "png", contentType: "image/png", maxBytes: 45 * 1024 * 1024 },
  ies: { extension: "ies", contentType: "text/plain; charset=utf-8", maxBytes: 2 * 1024 * 1024 },
} as const;

export type EnvironmentAssetKind = keyof typeof KINDS;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function looksLikeIes(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 512)).toUpperCase();
  return head.includes("IESNA") || head.includes("TILT=");
}

const UPLOAD_TTL_SECONDS = 15 * 60;

async function uploadTarget(context: PlatformContext, projectId: string) {
  if (!canPlatform(context, "platform.3d.view") || !canPlatform(context, "platform.3d.configure")) throw new AccessError("FORBIDDEN");
  const project = assertFound(await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } } },
    select: { id: true, companyId: true, project3DConfig: { select: { id: true, deletedAt: true } } },
  }));
  if (!project.project3DConfig || project.project3DConfig.deletedAt) throw new AccessError("NOT_FOUND");
  return project;
}

function tooLarge(bytes: number, kind: EnvironmentAssetKind) {
  return new AccessError("VALIDATION_ERROR", `Too large — ${Math.round(bytes / 1024 / 1024)}MB, max ${KINDS[kind].maxBytes / 1024 / 1024}MB.`, { field: "file" });
}

/**
 * Step 1 of an upload: a private storage key for the file and a short-lived
 * grant to send the bytes straight to storage (as model uploads do), with the
 * reference the Experience will keep once step 3 has checked the file.
 */
export async function createEnvironmentUpload(context: PlatformContext, projectId: string, kind: EnvironmentAssetKind, sizeBytes: number) {
  const project = await uploadTarget(context, projectId);
  const rule = KINDS[kind];
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new AccessError("VALIDATION_ERROR", "The file is empty.", { field: "file" });
  if (sizeBytes > rule.maxBytes) throw tooLarge(sizeBytes, kind);
  const storageKey = buildProject3DStorageKey({ companyId: project.companyId, projectId: project.id, kind: "environment", extension: rule.extension });
  const upload = await storageProvider().createUploadUrl({ storageKey, contentType: rule.contentType, maxBytes: sizeBytes, expiresInSeconds: UPLOAD_TTL_SECONDS });
  return {
    ref: `${ENVIRONMENT_REF_PREFIX}${storageKey.slice(storageKey.lastIndexOf("/") + 1)}`,
    upload: { method: upload.method, url: upload.url, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() },
  };
}

/**
 * Step 3: checks what arrived — a real PNG for a backdrop, an IES profile for a
 * light — and removes anything else, so a reference is only ever saved for a
 * file of the kind it claims.
 */
export async function completeEnvironmentUpload(context: PlatformContext, projectId: string, kind: EnvironmentAssetKind, ref: string): Promise<string> {
  const project = await uploadTarget(context, projectId);
  const file = environmentRefFile(ref);
  if (!file || !file.endsWith(`.${KINDS[kind].extension}`)) throw new AccessError("VALIDATION_ERROR", "Upload the file again.", { field: "file" });
  const storageKey = `companies/${project.companyId}/projects/${project.id}/3d/environment/${file}`;
  assertProject3DStorageKey(storageKey, project.companyId, project.id, "environment");
  const provider = storageProvider();
  const head = await provider.headObject(storageKey);
  if (!head) throw new AccessError("VALIDATION_ERROR", "The upload did not arrive. Upload the file again.", { field: "file" });
  const refuse = async (error: AccessError) => {
    await provider.deleteObject(storageKey).catch(() => undefined);
    throw error;
  };
  if (head.sizeBytes > KINDS[kind].maxBytes) return refuse(tooLarge(head.sizeBytes, kind));
  const bytes = (await provider.getObjectHead(storageKey, 512)) ?? new Uint8Array();
  if (kind === "backdrop" && !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return refuse(new AccessError("VALIDATION_ERROR", "Must be a PNG (the transparent-sky technique needs a real alpha channel).", { field: "file" }));
  }
  if (kind === "ies" && !looksLikeIes(bytes)) return refuse(new AccessError("VALIDATION_ERROR", "Must be an IES photometric profile (.ies).", { field: "file" }));
  return `${ENVIRONMENT_REF_PREFIX}${file}`;
}

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/** Streams one of a Project's environment files, once the caller has decided the reader may have it. */
export async function streamEnvironmentAsset(companyId: string, projectId: string, file: string): Promise<Response> {
  if (!ENVIRONMENT_FILE_PATTERN.test(file)) return new Response(null, { status: 404, headers: HEADERS });
  const storageKey = `companies/${companyId}/projects/${projectId}/3d/environment/${file}`;
  try {
    assertProject3DStorageKey(storageKey, companyId, projectId, "environment");
  } catch {
    return new Response(null, { status: 404, headers: HEADERS });
  }
  const bytes = await storageProvider().getObject(storageKey);
  if (!bytes) return new Response(null, { status: 404, headers: HEADERS });
  const contentType = file.endsWith(".png") ? KINDS.backdrop.contentType : KINDS.ies.contentType;
  return new Response(bytes as BodyInit, { status: 200, headers: { ...HEADERS, "Content-Type": contentType, "Content-Length": String(bytes.byteLength), "Content-Disposition": "inline" } });
}

/** The editor's read: any environment file of a Project with a 3D Experience, for a 3D Studio reader. */
export async function platformEnvironmentAsset(context: PlatformContext, projectId: string, file: string): Promise<Response> {
  if (!canPlatform(context, "platform.3d.view")) return new Response(null, { status: 404, headers: HEADERS });
  const project = await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } }, project3DConfig: { is: { deletedAt: null } } },
    select: { id: true, companyId: true },
  });
  if (!project) return new Response(null, { status: 404, headers: HEADERS });
  return streamEnvironmentAsset(project.companyId, project.id, file);
}

/**
 * The signed-in company viewer's read: only a file the active published release
 * uses, for a reader the viewer page itself would admit. Draft uploads and
 * files a later release dropped are never served here.
 */
export async function companyEnvironmentAsset(context: UserContext, projectId: string, file: string): Promise<Response> {
  if (!ENVIRONMENT_FILE_PATTERN.test(file) || !await hasActiveProject3DViewer(context, projectId)) return new Response(null, { status: 404, headers: HEADERS });
  const row = await prisma.project3DConfig.findFirst({
    where: { projectId, deletedAt: null },
    select: { companyId: true, projectId: true, activeRelease: { select: { status: true, manifest: true } } },
  });
  const manifest = row?.activeRelease?.status === "PUBLISHED" ? project3DReleaseManifestSchema.safeParse(row.activeRelease.manifest) : null;
  if (!row || !manifest?.success) return new Response(null, { status: 404, headers: HEADERS });
  const experience = manifest.data.experience as EnvironmentFields;
  if (!referencedEnvironmentFiles(experience).has(file)) return new Response(null, { status: 404, headers: HEADERS });
  return streamEnvironmentAsset(row.companyId, row.projectId, file);
}
