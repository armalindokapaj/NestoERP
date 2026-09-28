/**
 * The object-storage contract (PRD #29 §6, §7).
 *
 * Application code never touches a vendor SDK. It asks for a short-lived
 * capability to put or get one object, or for that object's metadata, and the
 * configured adapter decides how. A provider migration is then a configuration
 * change rather than a rewrite (PRD #29 §357, §359).
 *
 * Nothing here returns a permanent public URL, and nothing here decides who
 * may read a file. Authorisation happens above this layer, in the Documents
 * services, every single time (PRD #29 §4, §8).
 */

export type SignedUpload = {
  method: "PUT";
  url: string;
  /** Headers the browser must send for the signature to verify. */
  headers: Record<string, string>;
  expiresAt: Date;
};

export type SignedDownload = {
  url: string;
  expiresAt: Date;
};

export type StorageObjectMetadata = {
  storageKey: string;
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  /** SHA-256, when the provider computed one itself (PRD #29 §85, §86). */
  checksumSha256: string | null;
};

export type CreateUploadUrlInput = {
  storageKey: string;
  contentType: string;
  /** Bound into the signature where the provider supports it (PRD #29 §310). */
  maxBytes: number;
  expiresInSeconds: number;
};

export type CreateDownloadUrlInput = {
  storageKey: string;
  expiresInSeconds: number;
  /** Forces the browser's handling of the response (PRD #29 §43, §106). */
  disposition: "inline" | "attachment";
  fileName: string;
  contentType: string;
};

export interface StorageProvider {
  /** A short, human-meaningless provider name, stored on the document row. */
  readonly key: string;
  /** Deployment metadata, recorded so a bucket rename is traceable (§354). */
  readonly bucket: string;
  /** True when objects leave the app server directly (PRD #29 §389, §390). */
  readonly bypassesAppServer: boolean;

  createUploadUrl(input: CreateUploadUrlInput): Promise<SignedUpload>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownload>;

  /** Metadata for post-upload verification. Null when no object is there. */
  headObject(storageKey: string): Promise<StorageObjectMetadata | null>;

  /** The whole object, for an application-proxied read. */
  getObject(storageKey: string): Promise<Uint8Array | null>;

  /**
   * Just the leading bytes, for magic-byte detection. A separate method so
   * verifying a 100 MB CAD file does not mean loading 100 MB to look at six
   * of them (PRD #29 §31).
   */
  getObjectHead(storageKey: string, byteCount: number): Promise<Uint8Array | null>;

  /**
   * Bytes `start`..`end` (inclusive) as a stream, for gated delivery that must
   * not buffer a whole model in memory nor hand the browser a reusable storage
   * URL (ADM-04A §8). The caller bounds the range against `headObject` first.
   */
  openObjectRange(storageKey: string, start: number, end: number): Promise<ReadableStream<Uint8Array> | null>;

  /** A server-side write. Used by fixtures, seeds and quarantine moves. */
  putObject(storageKey: string, data: Uint8Array, contentType: string): Promise<StorageObjectMetadata>;

  deleteObject(storageKey: string): Promise<void>;

  copyObject?(input: { fromKey: string; toKey: string }): Promise<void>;

  /**
   * The largest object the store itself accepts, when it enforces one below
   * the product's own ceilings (a Supabase bucket's file size limit). Null when
   * it does not say. Callers refuse a larger file before any bytes move.
   */
  maxObjectBytes?(): Promise<number | null>;

  /** Bucket reachability, for the health probe (PRD #29 §397, §398). */
  healthCheck(): Promise<{ ok: boolean }>;
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A random object id, from the Web Crypto API rather than `node:crypto`.
 *
 * Everything below the provider adapters has to stay isomorphic: the upload
 * form is a client component and needs the size limits and the type registry,
 * and a single `node:fs` import anywhere in this module's reach breaks the
 * client bundle.
 */
function randomObjectId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * The object key (PRD #29 §19, §20).
 *
 * Company first, so one company's objects cannot be addressed from another's
 * key space even if an id leaked. The leaf is a random id and never the user's
 * file name: a name can carry PII, encode badly, or be guessed, and none of
 * that should reach the bucket.
 *
 * Keys are generated here and nowhere else. The browser never proposes one
 * (PRD #29 §18).
 */
export function buildStorageKey(input: {
  companyId: string;
  documentId: string;
  extension: string;
  /**
   * A caller-supplied object id, for fixtures that must be reproducible. Only
   * the seed uses it: production keys are random so two uploads of the same
   * file to the same document can never collide (PRD #29 §94, §180).
   */
  objectId?: string;
}): string {
  const objectId = input.objectId ?? randomObjectId();
  const suffix = input.extension ? `.${input.extension.toLowerCase()}` : "";
  return `companies/${input.companyId}/documents/${input.documentId}/${objectId}${suffix}`;
}

/** Derived objects sit under the original's prefix (PRD #29 §237). */
export function buildDerivedKey(input: {
  companyId: string;
  documentId: string;
  kind: "preview" | "thumb";
  extension: string;
}): string {
  return `companies/${input.companyId}/documents/${input.documentId}/derived/${input.kind}.${input.extension}`;
}

/**
 * Where an infected object goes (PRD #29 §62).
 *
 * A separate prefix rather than the normal one, so no lifecycle rule, listing
 * or migration written for business files ever touches it. A dedicated bucket
 * is better still and is a deployment choice.
 */
export function buildQuarantineKey(input: { companyId: string; documentId: string }): string {
  return `quarantine/${input.companyId}/${input.documentId}/${randomObjectId()}`;
}

/**
 * Refuses a key that escapes its company's prefix.
 *
 * Every provider calls this. It is the last line between a bug that builds a
 * key by string concatenation and a cross-company read (PRD #29 §361, §365).
 */
export function assertKeyBelongsToCompany(storageKey: string, companyId: string): void {
  const expected = `companies/${companyId}/`;
  const quarantine = `quarantine/${companyId}/`;
  if (!storageKey.startsWith(expected) && !storageKey.startsWith(quarantine)) {
    throw new Error("Refusing a storage key outside the company's prefix.");
  }
}

/** True for a key that is syntactically a NESTO object key. */
export function isWellFormedKey(storageKey: string): boolean {
  if (storageKey.length === 0 || storageKey.length > 512) return false;
  if (storageKey.includes("..") || storageKey.includes("\\") || storageKey.includes("\0")) return false;
  if (storageKey.startsWith("/")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(storageKey);
}
