import { assignedCompany } from "@/lib/access/project-ownership";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { project3DReleaseManifestSchema } from "@/lib/3d/shared/release.schema";
import type { PlatformContext } from "@/lib/context/platform-context";
import { canPlatform } from "@/lib/context/platform-context";
import type { UserContext } from "@/lib/context/types";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { availabilityOf, PROJECT_3D_AVAILABILITY_SELECT } from "./project-3d.lifecycle";
import { assertProject3DStorageKey } from "./project-3d.storage";
import { hasActiveProject3DViewer } from "./project-3d.viewer";

/**
 * Gated 3D asset delivery (ADM-04A §8).
 *
 * Browsers never receive a storage URL. They receive a handle bound to one
 * experience, one release, one asset, one audience and the experience's
 * accessEpoch, signed by the server. Every GET, HEAD and Range request re-checks
 * the whole grant — lifecycle, organization, entitlement, audience, active
 * release, and for company viewers the person's current project access —
 * before and again after the storage lookup, then streams the bytes itself.
 *
 * Any audience or release decision bumps accessEpoch, so every handle issued
 * before it stops working on its next request. Bytes already sent, files saved
 * and screenshots cannot be recalled; this is revocation, not DRM.
 */

export type DeliveryAudience = "company" | "public" | "preview" | "platform";

type HandleClaims = { v: 1; c: string; r: string; a: string; au: DeliveryAudience; e: number };

function deliverySecret(): string {
  const secret = process.env.STORAGE_URL_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("3D delivery requires STORAGE_URL_SECRET or AUTH_SECRET.");
  return secret;
}

function mac(payload: string): string {
  // Domain-separated from storage URL signatures, which share the secret.
  return createHmac("sha256", deliverySecret()).update(`project-3d-asset\n${payload}`).digest("base64url");
}

export function signProject3DAssetHandle(claims: Omit<HandleClaims, "v">): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, ...claims })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** The claims of a handle this server signed, or null — never an error that says which part was wrong. */
export function readProject3DAssetHandle(handle: string): HandleClaims | null {
  if (typeof handle !== "string" || handle.length > 600) return null;
  const [payload, signature, extra] = handle.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as HandleClaims;
    if (claims.v !== 1 || typeof claims.c !== "string" || typeof claims.r !== "string" || typeof claims.a !== "string" || !["company", "public", "preview", "platform"].includes(claims.au) || !Number.isInteger(claims.e)) return null;
    return claims;
  } catch {
    return null;
  }
}

/** A value that changes whenever what a viewer may load changes, without disclosing the epoch itself. */
export function project3DViewerToken(releaseId: string | null, accessEpoch: number): string {
  return createHash("sha256").update(`${releaseId ?? "none"}:${accessEpoch}`).digest("base64url").slice(0, 16);
}

type Requester =
  | { audience: "company"; context: UserContext; projectId: string }
  | { audience: "public"; publicId: string }
  | { audience: "preview"; context: PlatformContext; projectId: string }
  | { audience: "platform"; context: PlatformContext; projectId: string };

type Resolved = { storageKey: string; contentType: string };

/** A release's public delivery artifacts: opaque asset id → its derived object. */
export type Project3DPublicArtifacts = Record<string, { key: string; contentType: string }>;

const DELIVERABLE_TYPES = new Set(["model/gltf-binary", "image/jpeg", "image/png", "image/webp"]);

export function readPublicArtifacts(value: unknown): Project3DPublicArtifacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Project3DPublicArtifacts = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const artifact = entry as { key?: unknown; contentType?: unknown } | null;
    if (artifact && typeof artifact.key === "string" && typeof artifact.contentType === "string" && DELIVERABLE_TYPES.has(artifact.contentType)) out[id] = { key: artifact.key, contentType: artifact.contentType };
  }
  return out;
}

/**
 * The storage object a handle may deliver right now, or null. Null covers
 * every refusal alike — forged, stale, revoked, cross-project, unknown — so a
 * caller learns nothing about which experiences or assets exist.
 */
export async function authorizeProject3DAsset(handle: string, requester: Requester): Promise<Resolved | null> {
  const claims = readProject3DAssetHandle(handle);
  if (!claims || claims.au !== requester.audience) return null;

  const row = await prisma.project3DConfig.findUnique({
    where: { id: claims.c },
    select: { ...PROJECT_3D_AVAILABILITY_SELECT, project: { select: { ...PROJECT_3D_AVAILABILITY_SELECT.project.select, company: { select: { status: true, parentGroup: { select: { status: true, isTestFixture: true } } } } } } },
  });
  if (!row || row.deletedAt || row.accessEpoch !== claims.e) return null;

  if (requester.audience === "preview" || requester.audience === "platform") {
    if (row.projectId !== requester.projectId || !canPlatform(requester.context, "platform.3d.view") || assignedCompany(row.project).parentGroup.isTestFixture) return null;
    if (requester.audience === "platform" && row.activeReleaseId !== claims.r) return null;
  } else {
    if (row.activeReleaseId !== claims.r) return null;
    if (requester.audience === "public") {
      if (row.publicId !== requester.publicId || row.visibility !== "PUBLIC" || !availabilityOf(row).available) return null;
    } else {
      if (row.projectId !== requester.projectId || (row.visibility !== "COMPANY_ONLY" && row.visibility !== "PUBLIC" && row.visibility !== "PRIVATE")) return null;
      // Module, permission, project scope, entitlement and the published release — as the viewer page checks them.
      if (!await hasActiveProject3DViewer(requester.context, row.projectId)) return null;
    }
  }

  const release = await prisma.project3DRelease.findFirst({
    where: { id: claims.r, configId: row.id, projectId: row.projectId, companyId: row.companyId, status: "PUBLISHED" },
    select: { manifest: true, publicArtifactKeys: true, publicApprovedAt: true },
  });
  if (!release) return null;

  let resolved: Resolved | undefined;
  if (requester.audience === "company" || requester.audience === "platform") {
    const manifest = project3DReleaseManifestSchema.safeParse(release.manifest);
    const key = manifest.success ? manifest.data.models.find((model) => model.versionId === claims.a)?.runtimeStorageKey : undefined;
    if (key) resolved = { storageKey: key, contentType: "model/gltf-binary" };
  } else {
    if (requester.audience === "public" && !release.publicApprovedAt) return null;
    const artifact = readPublicArtifacts(release.publicArtifactKeys)[claims.a];
    if (artifact) resolved = { storageKey: artifact.key, contentType: artifact.contentType };
  }
  if (!resolved) return null;
  try {
    assertProject3DStorageKey(resolved.storageKey, row.companyId, row.projectId, requester.audience === "company" || requester.audience === "platform" ? "runtime" : "derived");
  } catch {
    return null;
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Range handling and the streamed response                                    */
/* -------------------------------------------------------------------------- */

export type ByteRange = { start: number; end: number };

/**
 * One `bytes=` range, as browsers and model loaders send it. Multiple ranges,
 * other units and malformed values are refused (416) rather than guessed at.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (header === null || header === "") return null;
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "unsatisfiable";
  if (size === 0) return "unsatisfiable";
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

const BASE_HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Accept-Ranges": "bytes",
};

export function refusedAsset(): Response {
  // One answer for every refusal: nothing about what exists.
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Streams an authorized asset. The grant is checked once more after the
 * storage lookup and immediately before the stream is handed back, so a
 * decision that committed while storage answered still refuses this request.
 */
export async function deliverProject3DAsset(request: Request, handle: string, requester: Requester): Promise<Response> {
  const first = await authorizeProject3DAsset(handle, requester);
  if (!first) return refusedAsset();

  const provider = storageProvider();
  const head = await provider.headObject(first.storageKey);
  if (!head) return refusedAsset();
  const size = head.sizeBytes;

  const range = parseByteRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...BASE_HEADERS, "Content-Range": `bytes */${size}` } });
  }

  // Re-checked after the storage lookup (§8).
  if (!await authorizeProject3DAsset(handle, requester)) return refusedAsset();

  const bounds = range ?? { start: 0, end: size - 1 };
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": first.contentType,
    "Content-Length": String(bounds.end - bounds.start + 1),
    "Content-Disposition": "inline",
  };
  if (range) headers["Content-Range"] = `bytes ${bounds.start}-${bounds.end}/${size}`;
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const body = size === 0 ? null : await provider.openObjectRange(first.storageKey, bounds.start, bounds.end);
  if (size > 0 && !body) return refusedAsset();
  // And once more immediately before the response is accepted.
  if (!await authorizeProject3DAsset(handle, requester)) {
    await body?.cancel().catch(() => undefined);
    return refusedAsset();
  }
  return new Response(body, { status, headers });
}
