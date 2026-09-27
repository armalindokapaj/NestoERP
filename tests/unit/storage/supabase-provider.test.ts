import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseStorageProvider } from "@/lib/core/storage/providers/supabase.provider";

/**
 * The Supabase Storage adapter against a recorded fake of the Storage REST API.
 * The answers mirror what storage-api really sends — notably a missing object
 * is HTTP 400 with `"statusCode": "404"` in its body.
 */

const BASE = "https://ref.supabase.co/storage/v1";
const KEY = "companies/c1/projects/p1/3d/source/abc.glb";
const JWT_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";

function token(payload: object): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const notFound = () => json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function provider(serviceKey = JWT_KEY) {
  return new SupabaseStorageProvider({ url: "https://ref.supabase.co/", serviceKey, bucket: "nesto-private" });
}
function call(index = 0): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetchMock.mock.calls[index];
  return { url, init };
}

describe("Supabase Storage provider", () => {
  it("signs a create-only upload for the one key and never claims longer than asked or than the token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    fetchMock.mockResolvedValueOnce(json({ url: `/object/upload/sign/nesto-private/${KEY}?token=${token({ upsert: false, exp })}` }));
    const before = Date.now();
    const grant = await provider().createUploadUrl({ storageKey: KEY, contentType: "model/gltf-binary", maxBytes: 100, expiresInSeconds: 900 });

    const { url, init } = call();
    expect(url).toBe(`${BASE}/object/upload/sign/nesto-private/${KEY}`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: JWT_KEY, Authorization: `Bearer ${JWT_KEY}` });
    expect(init.headers).not.toHaveProperty("x-upsert");
    expect(grant.method).toBe("PUT");
    expect(grant.url.startsWith(`${BASE}/object/upload/sign/nesto-private/${KEY}?token=`)).toBe(true);
    expect(grant.headers).toEqual({ "Content-Type": "model/gltf-binary" });
    expect(grant.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 900_000);
    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 900_000);

    fetchMock.mockResolvedValueOnce(json({ url: `/object/upload/sign/nesto-private/${KEY}?token=${token({ exp: Math.floor(Date.now() / 1000) + 60 })}` }));
    const short = await provider().createUploadUrl({ storageKey: KEY, contentType: "model/gltf-binary", maxBytes: 100, expiresInSeconds: 900 });
    expect(short.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("sends a secret key as an API key only, never as a bearer token", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "nesto-private", file_size_limit: null }));
    await expect(provider("sb_secret_abc").healthCheck()).resolves.toEqual({ ok: true });
    expect(call().init.headers).toEqual({ apikey: "sb_secret_abc" });
  });

  it("signs a download, as an attachment only when asked", async () => {
    fetchMock.mockImplementation(async () => json({ signedURL: `/object/sign/nesto-private/${KEY}?token=t` }));
    const inline = await provider().createDownloadUrl({ storageKey: KEY, expiresInSeconds: 300, disposition: "inline", fileName: "tower.glb", contentType: "model/gltf-binary" });
    expect(inline.url).toBe(`${BASE}/object/sign/nesto-private/${KEY}?token=t`);
    expect(JSON.parse(String(call().init.body))).toEqual({ expiresIn: 300 });
    const attachment = await provider().createDownloadUrl({ storageKey: KEY, expiresInSeconds: 300, disposition: "attachment", fileName: "Tower plan.glb", contentType: "model/gltf-binary" });
    expect(new URL(attachment.url).searchParams.get("download")).toBe("Tower plan.glb");
  });

  it("reads metadata, and reads Storage's 400-with-404 as a missing object", async () => {
    fetchMock.mockResolvedValueOnce(json({ size: 12504, content_type: "model/gltf-binary", etag: "\"e\"" }));
    await expect(provider().headObject(KEY)).resolves.toEqual({ storageKey: KEY, sizeBytes: 12504, contentType: "model/gltf-binary", etag: "\"e\"", checksumSha256: null });
    expect(call().url).toBe(`${BASE}/object/info/authenticated/nesto-private/${KEY}`);

    fetchMock.mockResolvedValueOnce(notFound());
    await expect(provider().headObject(KEY)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(json({ statusCode: "403", error: "Unauthorized" }, 400));
    await expect(provider().headObject(KEY)).rejects.toThrow("400");
    fetchMock.mockResolvedValueOnce(notFound());
    await expect(provider().getObject(KEY)).resolves.toBeNull();
  });

  it("reads only the leading bytes with a range request", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), { status: 200 }));
    await expect(provider().getObjectHead(KEY, 12)).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(call().init.headers).toMatchObject({ Range: "bytes=0-11" });
    expect(call().url).toBe(`${BASE}/object/authenticated/nesto-private/${KEY}`);
  });

  it("writes server-side with replace semantics and its own checksum", async () => {
    fetchMock.mockResolvedValueOnce(json({ Key: `nesto-private/${KEY}` }));
    const written = await provider().putObject(KEY, new Uint8Array([1, 2, 3]), "model/gltf-binary");
    expect(call().init).toMatchObject({ method: "POST", headers: { "x-upsert": "true", "Content-Type": "model/gltf-binary" } });
    expect(written).toMatchObject({ storageKey: KEY, sizeBytes: 3, checksumSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" });
  });

  it("treats deleting a missing object as done, and copies within the bucket", async () => {
    fetchMock.mockResolvedValueOnce(notFound());
    await expect(provider().deleteObject(KEY)).resolves.toBeUndefined();
    expect(call().init.method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(json({ Key: "x" }));
    await provider().copyObject({ fromKey: KEY, toKey: `${KEY}.copy` });
    expect(JSON.parse(String(call(1).init.body))).toEqual({ bucketId: "nesto-private", sourceKey: KEY, destinationKey: `${KEY}.copy` });
  });

  it("reports the bucket's file size limit, and keeps it for a while", async () => {
    const storage = provider();
    fetchMock.mockResolvedValueOnce(json({ id: "nesto-private", file_size_limit: 52_428_800 }));
    await expect(storage.maxObjectBytes()).resolves.toBe(52_428_800);
    await expect(storage.maxObjectBytes()).resolves.toBe(52_428_800);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(json({ id: "nesto-private", file_size_limit: null }));
    await expect(provider().maxObjectBytes()).resolves.toBeNull();
  });

  it("fails the health check when the bucket does not answer", async () => {
    fetchMock.mockResolvedValueOnce(json({ statusCode: "404", error: "Bucket not found" }, 400));
    await expect(provider().healthCheck()).resolves.toEqual({ ok: false });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(provider().healthCheck()).resolves.toEqual({ ok: false });
  });
});
