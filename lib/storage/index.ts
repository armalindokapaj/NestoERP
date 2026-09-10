import path from "node:path";

import { LocalDocumentStorage } from "./local.storage";
import type { DocumentStorage } from "./storage.interface";

export { buildStorageKey } from "./storage.interface";
export type { DocumentStorage, StoredObject } from "./storage.interface";

/**
 * Storage selection (PRD #13 §129, §159).
 *
 * V0.1 ships one adapter: the filesystem, rooted at `DOCUMENT_STORAGE_ROOT`
 * and defaulting to `.storage` beside the project. It is private, it is what
 * the tests run against, and it is what a single-server deployment can use.
 *
 * An S3-compatible adapter belongs here too and is deliberately not pretended
 * into existence: the interface, the key layout and the provider column are in
 * place so adding one is a new file and a config branch, but claiming object
 * storage exists when it does not would be worse than saying so
 * (PRD #13 §14, §33).
 *
 * Credentials, wherever they end up, stay server-side. Nothing in this module
 * is importable from a client component (PRD #13 §159).
 */
let cached: DocumentStorage | null = null;

export function documentStorage(): DocumentStorage {
  if (cached) return cached;

  const root = process.env.DOCUMENT_STORAGE_ROOT ?? path.join(process.cwd(), ".storage");
  cached = new LocalDocumentStorage(root);
  return cached;
}

/** Test seam: lets a suite point storage at a temporary directory. */
export function setDocumentStorage(storage: DocumentStorage | null): void {
  cached = storage;
}
