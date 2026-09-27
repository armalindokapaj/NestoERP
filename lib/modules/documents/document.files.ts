/**
 * The Documents module's view of the file type registry (PRD #13 §25-§31,
 * PRD #29 §41).
 *
 * The rules themselves moved to `lib/core/storage/file-type.registry.ts` when
 * PRD #29 made them a platform concern — one table now decides allowed types,
 * previewability and scan policy for every module, not just this one. What
 * stays here is the presentation layer the Documents UI reads: filter groups,
 * labels and sizes.
 */

import {
  DEFAULT_MAX_FILE_BYTES,
  extensionsForGroups as registryExtensionsForGroups,
  FILE_TYPES,
  fileTypeLabel,
  isPreviewableExtension,
} from "@/lib/core/storage";

export { extensionOf, sanitizeDisplayName } from "@/lib/core/storage";
export { fileTypeLabel };

/** User-facing type groups used by the list filter (PRD #13 §78, §170). */
export const FILE_TYPE_GROUPS = Object.fromEntries(
  FILE_TYPES.map((type) => [type.key, type.extensions]),
) as Record<string, string[]>;

export type FileTypeGroup = string;

export const fileTypeGroupLabels: Record<string, string> = Object.fromEntries(
  FILE_TYPES.map((type) => [type.key, type.label]),
);

export function extensionsForGroups(groups: FileTypeGroup[]): string[] {
  return registryExtensionsForGroups(groups);
}

/** Extensions that may be shown inline rather than downloaded (PRD #29 §44). */
export function isPreviewable(extension: string | null): boolean {
  return isPreviewableExtension(extension);
}

/** Human-readable size (PRD #13 §171). Bytes are what is stored. */
export function formatFileSize(bytes: number | bigint | null | string): string {
  if (bytes === null) return "—";
  const value = typeof bytes === "bigint" ? Number(bytes) : Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** The per-file ceiling shown in the upload form (PRD #29 §25). */
export { DEFAULT_MAX_FILE_BYTES as MAX_UPLOAD_BYTES } from "@/lib/core/storage";

/** The same ceiling the server enforces, in MB — never a second copy of the number (AUD-09 §8). */
export function maxUploadMegabytes(): number {
  return DEFAULT_MAX_FILE_BYTES / (1024 * 1024);
}
