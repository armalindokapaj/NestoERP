/**
 * Storage configuration constants (PRD #29 §25, §26, §69-§71, §130).
 *
 * Gathered in one place because these are policy numbers, not implementation
 * details, and every one of them is a security decision somebody should be
 * able to find and argue with.
 */

/** The product default per-file ceiling (PRD #29 §25, §26). */
export const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;

/** How long a browser has to push the bytes (PRD #29 §69). */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * How long a download or preview grant lives (PRD #29 §70, §71).
 *
 * Short on purpose. An already-issued signed URL cannot be revoked when
 * somebody's access changes, so the window in which that matters is the
 * window this number defines (PRD #29 §306, §308).
 */
export const DOWNLOAD_URL_TTL_SECONDS = 3 * 60;
export const PREVIEW_URL_TTL_SECONDS = 3 * 60;

/** How long an upload session stays open before cleanup may reclaim it (§69). */
export const UPLOAD_SESSION_TTL_MS = UPLOAD_URL_TTL_SECONDS * 1000;

/**
 * How long an abandoned object is left alone before deletion (PRD #29 §130).
 *
 * Generous, because deleting a file somebody is slowly uploading over a site
 * connection is far worse than keeping a dead object for another day
 * (PRD #29 §317).
 */
export const ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** Retries a browser should make on a transient upload failure (PRD #29 §120). */
export const UPLOAD_RETRY_LIMIT = 3;

/** Concurrent uploads the queue runs at once (PRD #29 §168). */
export const UPLOAD_CONCURRENCY = 3;

/*
 * Everything exported here is isomorphic on purpose.
 *
 * The upload form is a client component and needs the size ceiling and the
 * type registry, so this barrel must never reach a provider adapter — one
 * `node:fs` import in its shadow and the client bundle stops building. Server
 * code imports the provider from `./storage-provider.factory` directly.
 */
export * from "./storage-provider";
export * from "./storage.errors";
export * from "./storage-state";
export {
  assertDeclaredFileAllowed,
  fileTypeForExtension,
  fileTypeForName,
  fileTypeLabel,
  isPreviewableExtension,
  scanRequiredForExtension,
  normaliseMime,
  verifyContent,
  namedRefusal,
  extensionsForGroups,
  FILE_TYPES,
  FILE_TYPE_GROUP_KEYS,
  type AllowedFileType,
} from "./file-type.registry";
export { checkFileName, contentDisposition, extensionOf, sanitizeDisplayName } from "./file-name";
export { detectType, MAGIC_BYTE_WINDOW } from "./magic-bytes";
export { activeScanner, scannerEnabled, setFileScanner, type FileScanner } from "./scanner";
