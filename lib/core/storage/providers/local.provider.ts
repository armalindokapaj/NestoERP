import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

import type {
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  SignedDownload,
  SignedUpload,
  StorageObjectMetadata,
  StorageProvider,
} from "../storage-provider";
import { encodeClaims } from "../url-signing";

/**
 * Filesystem storage for development, test and CI (PRD #29 §117, §118).
 *
 * Objects live outside the web root and are never served statically. The only
 * way to reach one is a short-lived signed URL pointing at
 * `/api/storage/objects/...`, which verifies the signature and nothing else —
 * exactly the trust model of an S3 presigned URL, so the upload and download
 * paths exercised by the test suite are the ones that ship (PRD #29 §8).
 *
 * The honest caveat: bytes still travel through the Next server here, which is
 * what §389 says production must avoid. That is a property of the filesystem,
 * not of the architecture — `STORAGE_DRIVER=s3` makes the same flow direct,
 * and `lib/config/env.ts` already refuses this adapter in production.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly key = "local";
  readonly bucket: string;
  readonly bypassesAppServer = false;

  private readonly root: string;
  private readonly baseUrl: string;

  constructor(options: { root: string; baseUrl?: string }) {
    this.root = path.resolve(options.root);
    this.bucket = path.basename(this.root);
    /*
     * Root-relative by default, and that is deliberate.
     *
     * The only consumer of a local signed URL is the browser that just asked
     * for it, so letting it resolve the URL against its own origin removes a
     * whole class of misconfiguration: a stale `NEXT_PUBLIC_APP_URL` would
     * otherwise send a company's file bytes at whatever host it names. The
     * signature covers the key, the method and the expiry — never the host —
     * so nothing is weakened by leaving the origin out (PRD #29 §72).
     *
     * An S3 deployment needs an absolute URL and builds one itself; that URL
     * points at the bucket, not at NESTO (PRD #29 §9).
     */
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  }

  /**
   * Resolves a key inside the storage root and refuses anything that escapes
   * it. Keys are server-generated, but a traversal check at the boundary is
   * what makes that a guarantee rather than a convention (PRD #29 §223).
   */
  private resolve(storageKey: string): string {
    const target = path.resolve(this.root, storageKey);
    const boundary = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    if (target !== this.root && !target.startsWith(boundary)) {
      throw new Error("Refusing a storage key that escapes the storage root.");
    }
    return target;
  }

  private signedUrl(storageKey: string, params: URLSearchParams): string {
    const encodedKey = storageKey.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/api/storage/objects/${encodedKey}?${params.toString()}`;
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<SignedUpload> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    const params = encodeClaims({
      method: "PUT",
      storageKey: input.storageKey,
      expiresAt: expiresAt.getTime(),
      maxBytes: input.maxBytes,
      contentType: input.contentType,
    });

    return {
      method: "PUT",
      url: this.signedUrl(input.storageKey, params),
      // Bound into the signature, so a browser that sends a different type is
      // refused rather than quietly storing something else (PRD #29 §312).
      headers: { "Content-Type": input.contentType },
      expiresAt,
    };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownload> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    const params = encodeClaims({
      method: "GET",
      storageKey: input.storageKey,
      expiresAt: expiresAt.getTime(),
      contentType: input.contentType,
      disposition: input.disposition,
      fileName: input.fileName,
    });

    return { url: this.signedUrl(input.storageKey, params), expiresAt };
  }

  async headObject(storageKey: string): Promise<StorageObjectMetadata | null> {
    try {
      const info = await stat(this.resolve(storageKey));
      if (!info.isFile()) return null;
      return {
        storageKey,
        sizeBytes: info.size,
        // The filesystem holds no content type; the caller detects it from the
        // bytes, which is the authoritative answer anyway (PRD #29 §31).
        contentType: null,
        etag: `${info.size.toString(16)}-${info.mtimeMs.toString(16)}`,
        checksumSha256: null,
      };
    } catch {
      return null;
    }
  }

  async getObject(storageKey: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(storageKey)));
    } catch {
      // A missing object is a state the caller handles, not a crash (§157).
      return null;
    }
  }

  async openObjectRange(storageKey: string, start: number, end: number): Promise<ReadableStream<Uint8Array> | null> {
    const target = this.resolve(storageKey);
    try {
      await stat(target);
    } catch {
      return null;
    }
    return Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream<Uint8Array>;
  }

  async getObjectHead(storageKey: string, byteCount: number): Promise<Uint8Array | null> {
    let handle;
    try {
      handle = await open(this.resolve(storageKey), "r");
      const buffer = Buffer.alloc(byteCount);
      const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
      return new Uint8Array(buffer.subarray(0, bytesRead));
    } catch {
      return null;
    } finally {
      await handle?.close();
    }
  }

  async putObject(
    storageKey: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<StorageObjectMetadata> {
    const target = this.resolve(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);

    const written = await stat(target);
    return {
      storageKey,
      sizeBytes: written.size,
      contentType,
      etag: `${written.size.toString(16)}-${written.mtimeMs.toString(16)}`,
      checksumSha256: createHash("sha256").update(data).digest("hex"),
    };
  }

  /**
   * A browser upload's write: creates the object, and refuses — returning null —
   * when one is already at that key (PRD #47 §83).
   *
   * The local twin of the `If-None-Match: *` the S3 adapter signs into its
   * upload grants. The exclusive create is atomic, so two PUTs racing on the
   * same grant cannot both land, and bytes that `/complete` has verified can
   * never be replaced through the grant that brought them.
   */
  async putObjectIfAbsent(
    storageKey: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<StorageObjectMetadata | null> {
    const target = this.resolve(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, data, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
    }

    const written = await stat(target);
    return {
      storageKey,
      sizeBytes: written.size,
      contentType,
      etag: `${written.size.toString(16)}-${written.mtimeMs.toString(16)}`,
      checksumSha256: createHash("sha256").update(data).digest("hex"),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }

  async copyObject(input: { fromKey: string; toKey: string }): Promise<void> {
    const bytes = await this.getObject(input.fromKey);
    if (bytes === null) throw new Error("Cannot copy an object that does not exist.");
    await this.putObject(input.toKey, bytes, "application/octet-stream");
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      await mkdir(this.root, { recursive: true });
      await stat(this.root);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}
