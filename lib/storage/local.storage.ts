import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DocumentStorage, StoredObject } from "./storage.interface";

/**
 * Filesystem storage for development, test and CI (PRD #13 §14, §267, §269).
 *
 * Objects live outside the web root and are never served statically — the only
 * way to read one is through the authenticated download route, which re-checks
 * permission, parent access and document state on every request (PRD #13 §18).
 *
 * This is a real adapter, not a stub: it is what `pnpm test` runs against, so
 * the upload and download paths under test are the ones the product uses.
 */
export class LocalDocumentStorage implements DocumentStorage {
  readonly provider = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Resolves a key inside the storage root and refuses anything that escapes
   * it. Keys are built by the service, but a traversal check at the boundary
   * is what makes that a guarantee rather than a convention (PRD #13 §155).
   */
  private resolve(storageKey: string): string {
    const target = path.resolve(this.root, storageKey);
    const boundary = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    if (target !== this.root && !target.startsWith(boundary)) {
      throw new Error("Refusing a storage key that escapes the storage root.");
    }
    return target;
  }

  async put(storageKey: string, data: Uint8Array): Promise<StoredObject> {
    const target = this.resolve(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);

    const written = await stat(target);
    return {
      storageKey,
      sizeBytes: written.size,
      checksum: createHash("sha256").update(data).digest("hex"),
    };
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(storageKey)));
    } catch {
      // A missing object is a state the caller has to handle, not a crash
      // (PRD #13 §116).
      return null;
    }
  }

  async objectExists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.resolve(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }
}
