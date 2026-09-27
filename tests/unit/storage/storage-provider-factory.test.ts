import { afterEach, describe, expect, it, vi } from "vitest";

import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";

/** Driver selection from the environment (PRD #29 §114, §115). */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setStorageProvider(null);
});

function supabaseEnv(url = "https://ref.supabase.co") {
  vi.stubEnv("STORAGE_DRIVER", "supabase");
  vi.stubEnv("SUPABASE_URL", url);
  vi.stubEnv("STORAGE_BUCKET", "nesto-private");
}

describe("the storage provider factory", () => {
  it("builds the Supabase driver from the integration's variables, preferring the secret key", async () => {
    supabaseEnv();
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_new");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJ.legacy.jwt");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "nesto-private" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = storageProvider();
    expect(provider).toMatchObject({ key: "supabase", bucket: "nesto-private", bypassesAppServer: true });
    await expect(provider.healthCheck()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("https://ref.supabase.co/storage/v1/bucket/nesto-private", expect.objectContaining({ headers: { apikey: "sb_secret_new" } }));
  });

  it("falls back to the legacy service_role key", () => {
    supabaseEnv();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJ.legacy.jwt");
    expect(storageProvider().key).toBe("supabase");
  });

  it("names what is missing", () => {
    supabaseEnv();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => storageProvider()).toThrow("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required when STORAGE_DRIVER=supabase.");
    setStorageProvider(null);
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_new");
    vi.stubEnv("STORAGE_BUCKET", "");
    expect(() => storageProvider()).toThrow("STORAGE_BUCKET is required when STORAGE_DRIVER=supabase.");
  });

  it("refuses plain HTTP in production, and does not trip over variables storage never reads", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_new");
    supabaseEnv("http://storage.internal:5000");
    expect(() => storageProvider()).toThrow("Object storage must be reached over HTTPS in production.");
    setStorageProvider(null);
    supabaseEnv("https://ref.supabase.co");
    expect(storageProvider().key).toBe("supabase");
  });

  it("allows plain HTTP to a development Storage", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_new");
    supabaseEnv("http://localhost:54321");
    expect(storageProvider().key).toBe("supabase");
  });
});
