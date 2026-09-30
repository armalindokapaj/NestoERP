import type { ArtificialLight, Project3DConfig } from "@/lib/3d/runtime/types";

/*
 * References to an Experience's stored environment files — the 360° backdrop
 * photo and IES light profiles (lib/modules/project-3d/project-3d.environment-assets.ts).
 * Client-safe: the editor resolves them for its own viewport as the server does
 * for each viewer audience.
 */

export const ENVIRONMENT_REF_PREFIX = "nesto-env:";

export const ENVIRONMENT_FILE_PATTERN = /^[a-f0-9]{32}\.(png|ies)$/;

/** The stored file a reference names, or null for anything else (an external address, say). */
export function environmentRefFile(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(ENVIRONMENT_REF_PREFIX)) return null;
  const file = value.slice(ENVIRONMENT_REF_PREFIX.length);
  return ENVIRONMENT_FILE_PATTERN.test(file) ? file : null;
}

export type EnvironmentFields = Pick<Project3DConfig, "backdropImageUrl"> & { artificialLights?: ArtificialLight[] };

/** Every stored environment file an Experience refers to. */
export function referencedEnvironmentFiles(experience: EnvironmentFields): Set<string> {
  const files = new Set<string>();
  const backdrop = environmentRefFile(experience.backdropImageUrl);
  if (backdrop) files.add(backdrop);
  for (const light of experience.artificialLights ?? []) {
    const ies = environmentRefFile(light.iesProfileUrl);
    if (ies) files.add(ies);
  }
  return files;
}

/**
 * The Experience with its references turned into addresses under `base`. A
 * reference to a file that is not well formed is dropped, never passed on.
 */
export function resolveEnvironmentRefs<T extends EnvironmentFields>(experience: T, base: string): T {
  const resolve = (value: string | null | undefined) => {
    if (!value?.startsWith(ENVIRONMENT_REF_PREFIX)) return value ?? null;
    const file = environmentRefFile(value);
    return file ? `${base}/${file}` : null;
  };
  return {
    ...experience,
    backdropImageUrl: resolve(experience.backdropImageUrl),
    ...(experience.artificialLights ? { artificialLights: experience.artificialLights.map((light) => ({ ...light, iesProfileUrl: resolve(light.iesProfileUrl) })) } : {}),
  };
}

export const platformEnvironmentBase = (projectId: string) => `/api/platform/3d/projects/${projectId}/environment-assets`;
export const companyEnvironmentBase = (projectId: string) => `/api/projects/${projectId}/3d/environment-assets`;
