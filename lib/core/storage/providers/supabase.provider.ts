import { createHash } from "node:crypto";

import { StorageError } from "../storage.errors";
import type {
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  SignedDownload,
  SignedUpload,
  StorageObjectMetadata,
  StorageProvider,
} from "../storage-provider";

/**
 * Supabase Storage, a private bucket reached over its REST API.
 *
 * For a deployment whose database already is Supabase and that has no other
 * object store — Vercel with the Supabase integration, which puts the project
 * URL and its server key into the environment. The key never leaves the
 * server. The browser gets what an S3 presign would give it: one short-lived
 * capability for one object. An upload grant can create its key and never
 * overwrite it (upsert is off in the signed token, and Storage refuses a second
 * write), which is the `If-None-Match: *` of the S3 adapter (PRD #47 §83).
 *
 * Storage answers a missing object with HTTP 400 and `"statusCode": "404"` in
 * the body, so "not found" is read from the body as well as the status.
 */

/** Same deadlines as the S3 adapter (AUD-07 §7). */
const STORAGE_CALL_MS = { head: 10_000, transfer: 60_000 } as const;
/** How long a bucket's size limit is trusted before it is read again. */
const BUCKET_LIMIT_TTL_MS = 5 * 60 * 1000;

export type SupabaseProviderOptions = {
  /** The project URL, `https://<ref>.supabase.co`. Storage lives at `/storage/v1`. */
  url: string;
  /**
   * A secret key (`sb_secret_…`) or the legacy `service_role` JWT. A secret key
   * is not a JWT and goes in `apikey` only; the gateway puts the matching
   * token in front of Storage.
   */
  serviceKey: string;
  bucket: string;
  /** Storage's own base URL, for a self-hosted Storage without the gateway. */
  storageUrl?: string;
};

/** The origin browsers talk to for this Storage: the only one the CSP needs to allow. */
export function supabaseStorageBaseUrl(options: { url: string; storageUrl?: string }): string {
  return (options.storageUrl ?? `${options.url.replace(/\/+$/, "")}/storage/v1`).replace(/\/+$/, "");
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly key = "supabase";
  readonly bucket: string;
  readonly bypassesAppServer = true;

  private readonly base: string;
  private readonly serviceKey: string;
  private bucketLimit: { value: number | null; readAt: number } | null = null;

  constructor(options: SupabaseProviderOptions) {
    this.bucket = options.bucket;
    this.base = supabaseStorageBaseUrl(options);
    this.serviceKey = options.serviceKey;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { apikey: this.serviceKey };
    if (!this.serviceKey.startsWith("sb_")) headers.Authorization = `Bearer ${this.serviceKey}`;
    return { ...headers, ...extra };
  }

  private objectPath(storageKey: string): string {
    return `${encodeURIComponent(this.bucket)}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
  }

  private request(path: string, init: RequestInit & { headers?: Record<string, string> }, timeoutMs: number): Promise<Response> {
    return fetch(`${this.base}${path}`, { ...init, headers: this.headers(init.headers), signal: AbortSignal.timeout(timeoutMs) });
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<SignedUpload> {
    // No `x-upsert` here: the token is signed for a create, never a replace.
    const response = await this.request(`/object/upload/sign/${this.objectPath(input.storageKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, STORAGE_CALL_MS.head);
    if (!response.ok) throw new Error(`Storage upload grant failed with ${response.status}`);
    const { url } = (await response.json()) as { url?: string };
    if (!url) throw new Error("Storage upload grant returned no URL");
    // Storage decides the token's own lifetime (two hours on Supabase); the
    // grant never claims longer than the caller asked for, nor than the token.
    const asked = Date.now() + input.expiresInSeconds * 1000;
    const expiresAt = new Date(Math.min(asked, tokenExpiry(url) ?? asked));
    // The type is sent, and Storage stores it; the authoritative checks are the
    // HEAD and magic-byte verification after the upload (PRD #29 §27, §311).
    return { method: "PUT", url: `${this.base}${url}`, headers: { "Content-Type": input.contentType }, expiresAt };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownload> {
    const response = await this.request(`/object/sign/${this.objectPath(input.storageKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: input.expiresInSeconds }) }, STORAGE_CALL_MS.head);
    // Unlike an S3 presign, Supabase looks the object up before it signs.
    if (await isMissing(response)) throw new StorageError("STORAGE_OBJECT_MISSING", "The stored file is missing.");
    if (!response.ok) throw new Error(`Storage download grant failed with ${response.status}`);
    const { signedURL } = (await response.json()) as { signedURL?: string };
    if (!signedURL) throw new Error("Storage download grant returned no URL");
    const url = new URL(`${this.base}${signedURL}`);
    // Storage serves the stored type; `download` makes it an attachment with this name.
    if (input.disposition === "attachment") url.searchParams.set("download", input.fileName);
    return { url: url.toString(), expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000) };
  }

  async headObject(storageKey: string): Promise<StorageObjectMetadata | null> {
    const response = await this.request(`/object/info/authenticated/${this.objectPath(storageKey)}`, { method: "GET" }, STORAGE_CALL_MS.head);
    if (await isMissing(response)) return null;
    if (!response.ok) throw new Error(`Storage HEAD failed with ${response.status}`);
    const info = (await response.json()) as { size?: number; content_type?: string | null; etag?: string | null };
    return {
      storageKey,
      sizeBytes: typeof info.size === "number" ? info.size : 0,
      contentType: info.content_type ?? null,
      etag: info.etag ?? null,
      checksumSha256: null,
    };
  }

  async getObject(storageKey: string): Promise<Uint8Array | null> {
    const response = await this.request(`/object/authenticated/${this.objectPath(storageKey)}`, { method: "GET" }, STORAGE_CALL_MS.transfer);
    if (await isMissing(response)) return null;
    if (!response.ok) throw new Error(`Storage GET failed with ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async openObjectRange(storageKey: string, start: number, end: number): Promise<ReadableStream<Uint8Array> | null> {
    const response = await this.request(`/object/authenticated/${this.objectPath(storageKey)}`, { method: "GET", headers: { Range: `bytes=${start}-${end}` } }, STORAGE_CALL_MS.transfer);
    if (await isMissing(response)) return null;
    // A store that ignored Range would send the wrong bytes for a partial read.
    if (response.status !== 206 && !(response.status === 200 && start === 0)) throw new Error(`Storage range GET failed with ${response.status}`);
    return response.body;
  }

  async getObjectHead(storageKey: string, byteCount: number): Promise<Uint8Array | null> {
    const response = await this.request(`/object/authenticated/${this.objectPath(storageKey)}`, { method: "GET", headers: { Range: `bytes=0-${byteCount - 1}` } }, STORAGE_CALL_MS.head);
    if (await isMissing(response)) return null;
    if (!response.ok) throw new Error(`Storage range GET failed with ${response.status}`);
    // A server that ignores Range sends the whole object; only the head is kept.
    return new Uint8Array(await response.arrayBuffer()).slice(0, byteCount);
  }

  async putObject(storageKey: string, data: Uint8Array, contentType: string): Promise<StorageObjectMetadata> {
    // A server-side write replaces what is there, as an S3 PutObject does.
    const response = await this.request(`/object/${this.objectPath(storageKey)}`, {
      method: "POST",
      headers: { "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "no-cache" },
      body: data as unknown as BodyInit,
    }, STORAGE_CALL_MS.transfer);
    if (!response.ok) throw new Error(`Storage upload failed with ${response.status}`);
    return {
      storageKey,
      sizeBytes: data.byteLength,
      contentType,
      etag: null,
      checksumSha256: createHash("sha256").update(data).digest("hex"),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    const response = await this.request(`/object/${this.objectPath(storageKey)}`, { method: "DELETE" }, STORAGE_CALL_MS.head);
    // Deleting a key that is not there is done, as it is for S3.
    if (await isMissing(response)) return;
    if (!response.ok) throw new Error(`Storage DELETE failed with ${response.status}`);
  }

  async copyObject(input: { fromKey: string; toKey: string }): Promise<void> {
    const response = await this.request("/object/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucketId: this.bucket, sourceKey: input.fromKey, destinationKey: input.toKey }),
    }, STORAGE_CALL_MS.transfer);
    if (await isMissing(response)) throw new Error("Cannot copy an object that does not exist.");
    if (!response.ok) throw new Error(`Storage copy failed with ${response.status}`);
  }

  /** The bucket's own per-file limit, when it has one; Supabase refuses anything larger. */
  async maxObjectBytes(): Promise<number | null> {
    if (this.bucketLimit && Date.now() - this.bucketLimit.readAt < BUCKET_LIMIT_TTL_MS) return this.bucketLimit.value;
    try {
      const response = await this.request(`/bucket/${encodeURIComponent(this.bucket)}`, { method: "GET" }, STORAGE_CALL_MS.head);
      if (!response.ok) return this.bucketLimit?.value ?? null;
      const bucket = (await response.json()) as { file_size_limit?: number | null };
      const value = typeof bucket.file_size_limit === "number" && bucket.file_size_limit > 0 ? bucket.file_size_limit : null;
      this.bucketLimit = { value, readAt: Date.now() };
      return value;
    } catch {
      return this.bucketLimit?.value ?? null;
    }
  }

  /** Reachability: the bucket answers with these credentials (PRD #29 §397, §398). */
  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      const response = await this.request(`/bucket/${encodeURIComponent(this.bucket)}`, { method: "GET" }, STORAGE_CALL_MS.head);
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }
}

/** Storage's "not found": a 404, or a 400 whose body says 404. Reads the body only then. */
async function isMissing(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const body = (await response.clone().json()) as { statusCode?: string; error?: string };
    return body.statusCode === "404" || body.error === "not_found";
  } catch {
    return false;
  }
}

/** The `exp` of the token in a signed Storage URL, in milliseconds. */
function tokenExpiry(signedUrl: string): number | null {
  try {
    const token = new URL(signedUrl, "https://storage.invalid").searchParams.get("token");
    const payload = token?.split(".")[1];
    if (!payload) return null;
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}
