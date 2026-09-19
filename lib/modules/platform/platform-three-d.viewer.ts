import type { UserContext } from "@/lib/context/types";
import { AccessError, assertFound } from "@/lib/access/guards";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { getProject } from "@/lib/modules/projects/project.service";

const VIEWER_GRANT_SECONDS = 180;

/** A tenant-scoped, short-lived projection of the published 3D model. */
export async function createThreeDViewerGrant(context: UserContext, projectId: string) {
  const project = await getProject(context, projectId);
  const configuration = assertFound(await prisma.threeDProjectConfiguration.findFirst({
    where: { projectId: project.id, status: "PUBLISHED", publishedVersionId: { not: null } },
    select: { publishedAt: true, publishedVersionId: true, versions: { where: { status: "PUBLISHED" }, take: 1, orderBy: { version: "desc" }, select: { id: true, version: true, name: true, storageKey: true, sourceFileName: true } } },
  }));
  const version = assertFound(configuration.versions[0]);
  if (!version.storageKey) throw new AccessError("CONFLICT", "The published model has no viewer artifact.");
  const fileName = version.sourceFileName ?? `project-${project.code}-v${version.version}.glb`;
  if (!/\.(glb|gltf)$/i.test(fileName) && !/\.(glb|gltf)$/i.test(version.storageKey)) {
    throw new AccessError("CONFLICT", "The published viewer artifact must be GLB or glTF.");
  }
  const contentType = /\.gltf$/i.test(fileName) ? "model/gltf+json" : "model/gltf-binary";
  const grant = await storageProvider().createDownloadUrl({ storageKey: version.storageKey, expiresInSeconds: VIEWER_GRANT_SECONDS, disposition: "inline", fileName, contentType });
  return { url: grant.url, expiresAt: grant.expiresAt.toISOString(), project: { id: project.id, code: project.code, name: project.name }, version: { id: version.id, number: version.version, name: version.name }, publishedAt: configuration.publishedAt?.toISOString() ?? null };
}
