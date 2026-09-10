/**
 * The document storage contract (PRD #13 §15).
 *
 * Application code never touches a vendor SDK. It asks for an object to be
 * put, read, checked or removed, and the configured adapter decides how — so a
 * provider migration is a configuration change rather than a rewrite
 * (PRD #13 §286).
 *
 * Object storage is private by default. Nothing here returns a permanent
 * public URL, and nothing here decides who may read a file: authorisation
 * happens in the Documents service, above this layer (PRD #13 §17).
 */

export type StoredObject = {
  storageKey: string;
  sizeBytes: number;
  /** SHA-256, for integrity and duplicate diagnostics only (PRD #13 §32). */
  checksum: string;
};

export interface DocumentStorage {
  /** A short, human-meaningless name for the provider, stored on the row. */
  readonly provider: string;

  /**
   * Writes an object and reports what was actually stored — the size is
   * measured here, not taken from the browser's claim (PRD #13 §31).
   */
  put(storageKey: string, data: Uint8Array): Promise<StoredObject>;

  /** Reads an object back for an authorised, authenticated download. */
  get(storageKey: string): Promise<Uint8Array | null>;

  objectExists(storageKey: string): Promise<boolean>;

  /**
   * Removes an object. Used to clean up after a failed finalisation, never as
   * part of archiving: archiving keeps the file (PRD #13 §96, §112).
   */
  deleteObject(storageKey: string): Promise<void>;
}

/**
 * The tenant-safe object key (PRD #13 §16).
 *
 * The company id leads, so one company's objects can never be addressed from
 * another's key space even if an id leaked.
 */
export function buildStorageKey(
  companyId: string,
  documentId: string,
  safeFileName: string,
): string {
  return `companies/${companyId}/documents/${documentId}/${safeFileName}`;
}
