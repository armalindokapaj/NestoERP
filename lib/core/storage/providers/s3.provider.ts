import { createHash } from "node:crypto";

import { contentDisposition } from "../file-name";
import type {
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  SignedDownload,
  SignedUpload,
  StorageObjectMetadata,
  StorageProvider,
} from "../storage-provider";
import { presignUrl, type SigV4Config } from "./sigv4";

/**
 * S3-compatible private object storage (PRD #29 §5, §6).
 *
 * Works unchanged against AWS S3, Cloudflare R2, MinIO, Backblaze B2 and
 * DigitalOcean Spaces, because all it uses is presigned SigV4 and plain HTTPS.
 * There is no SDK: `sigv4.ts` is verified against AWS's own published test
 * vectors, which is a stronger guarantee than a version pin.
 *
 * Every URL this returns is short-lived and private. The bucket must block
 * public access and anonymous listing — that is a deployment control this code
 * cannot enforce, and `scripts/verify-production-guards.ts` checks it
 * (PRD #29 §8, §110, §309).
 */

/**
 * How long one storage call may take before the request gives up on it
 * (AUD-07 §7): metadata calls are small, transfers get the presigned URL's own
 * lifetime. Without a deadline a hung bucket held the request until the platform killed it.
 */
const STORAGE_CALL_MS = { head: 10_000, transfer: 60_000 } as const;

export type S3ProviderOptions = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** MinIO and some gateways require path-style addressing (PRD #29 §359). */
  forcePathStyle: boolean;
};

export class S3StorageProvider implements StorageProvider {
  readonly key = "s3";
  readonly bucket: string;
  readonly bypassesAppServer = true;

  private readonly options: S3ProviderOptions;
  private readonly host: string;
  private readonly protocol: "https" | "http";
  private readonly sigv4: SigV4Config;

  constructor(options: S3ProviderOptions) {
    this.options = options;
    this.bucket = options.bucket;

    const url = new URL(options.endpoint);
    this.protocol = url.protocol === "http:" ? "http" : "https";
    this.host = options.forcePathStyle ? url.host : `${options.bucket}.${url.host}`;

    this.sigv4 = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
      region: options.region,
      service: "s3",
    };
  }

  /** Bucket in the path for path-style, in the host otherwise. */
  private objectPath(storageKey: string): string {
    return this.options.forcePathStyle
      ? `/${this.options.bucket}/${storageKey}`
      : `/${storageKey}`;
  }

  private presign(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    storageKey: string,
    expiresInSeconds: number,
    query?: Record<string, string>,
    signedHeaders?: Record<string, string>,
  ): string {
    return presignUrl(this.sigv4, {
      method,
      host: this.host,
      path: this.objectPath(storageKey),
      query,
      signedHeaders,
      expiresInSeconds,
      protocol: this.protocol,
    });
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<SignedUpload> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);

    /*
     * Single use (PRD #47 §83). The grant outlives the upload it was issued
     * for, so without a condition its holder could PUT different bytes over an
     * object after /complete had verified — and scanned — the first ones.
     * `If-None-Match: *` makes the bucket refuse to overwrite an existing
     * object (S3, R2 and MinIO all honour it on PutObject), and signing it
     * means the header cannot simply be left off.
     */
    const condition = { "If-None-Match": "*" };

    return {
      method: "PUT",
      url: this.presign("PUT", input.storageKey, input.expiresInSeconds, undefined, condition),
      /*
       * The type is sent but not signed. Presigned-PUT support for a
       * content-length condition varies by provider, so the authoritative
       * checks are the HEAD and magic-byte verification after the upload —
       * which is what §311 says to do, and what §27 requires anyway.
       */
      headers: { "Content-Type": input.contentType, ...condition },
      expiresAt,
    };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownload> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);

    // S3 honours these response overrides on a signed GET, so the browser sees
    // the verified type and a sanitised file name rather than whatever the
    // object's stored metadata happens to say (PRD #29 §195, §196).
    const url = this.presign("GET", input.storageKey, input.expiresInSeconds, {
      "response-content-type": input.contentType,
      "response-content-disposition": contentDisposition(input.disposition, input.fileName),
    });

    return { url, expiresAt };
  }

  async headObject(storageKey: string): Promise<StorageObjectMetadata | null> {
    const response = await fetch(this.presign("HEAD", storageKey, 60), { method: "HEAD", signal: AbortSignal.timeout(STORAGE_CALL_MS.head) });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error(`Storage HEAD failed with ${response.status}`);

    const length = Number(response.headers.get("content-length"));

    return {
      storageKey,
      sizeBytes: Number.isFinite(length) ? length : 0,
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      // Present only when the bucket was asked to compute one on upload
      // (PRD #29 §85). Base64 in the header; stored as hex everywhere else.
      checksumSha256: decodeChecksum(response.headers.get("x-amz-checksum-sha256")),
    };
  }

  async getObject(storageKey: string): Promise<Uint8Array | null> {
    const response = await fetch(this.presign("GET", storageKey, 60), { signal: AbortSignal.timeout(STORAGE_CALL_MS.transfer) });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error(`Storage GET failed with ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async getObjectHead(storageKey: string, byteCount: number): Promise<Uint8Array | null> {
    const response = await fetch(this.presign("GET", storageKey, 60), {
      signal: AbortSignal.timeout(STORAGE_CALL_MS.head),
      headers: { Range: `bytes=0-${byteCount - 1}` },
    });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok && response.status !== 206) {
      throw new Error(`Storage range GET failed with ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async putObject(
    storageKey: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<StorageObjectMetadata> {
    const response = await fetch(this.presign("PUT", storageKey, 120), {
      method: "PUT",
      signal: AbortSignal.timeout(STORAGE_CALL_MS.transfer),
      headers: { "Content-Type": contentType },
      body: data as unknown as BodyInit,
    });
    if (!response.ok) throw new Error(`Storage PUT failed with ${response.status}`);

    return {
      storageKey,
      sizeBytes: data.byteLength,
      contentType,
      etag: response.headers.get("etag"),
      checksumSha256: createHash("sha256").update(data).digest("hex"),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    const response = await fetch(this.presign("DELETE", storageKey, 60), { method: "DELETE", signal: AbortSignal.timeout(STORAGE_CALL_MS.head) });
    // S3 answers 204 for a delete, and also for a key that was never there.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Storage DELETE failed with ${response.status}`);
    }
  }

  async copyObject(input: { fromKey: string; toKey: string }): Promise<void> {
    const bytes = await this.getObject(input.fromKey);
    if (bytes === null) throw new Error("Cannot copy an object that does not exist.");
    await this.putObject(input.toKey, bytes, "application/octet-stream");
  }

  /**
   * Reachability only. It asks about one key that is not expected to exist:
   * a 404 proves the credentials and the bucket work without listing anything
   * or naming the bucket in the answer (PRD #29 §397, §398).
   */
  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      const response = await fetch(this.presign("HEAD", ".nesto-health-probe", 30), {
        method: "HEAD",
        signal: AbortSignal.timeout(STORAGE_CALL_MS.head),
      });
      return { ok: response.status === 404 || response.ok };
    } catch {
      return { ok: false };
    }
  }
}

function decodeChecksum(header: string | null): string | null {
  if (!header) return null;
  try {
    return Buffer.from(header, "base64").toString("hex");
  } catch {
    return null;
  }
}
