import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, storageOriginForCsp } from "@/lib/core/security/csp";

describe("Content Security Policy", () => {
  it("allows the private bucket's exact origin for uploads, previews and models, and nothing wider", () => {
    const origin = storageOriginForCsp({ STORAGE_DRIVER: "s3", STORAGE_ENDPOINT: "https://storage.example.test:8443/path", STORAGE_BUCKET: "private-models" });
    expect(origin).toBe("https://storage.example.test:8443");
    const policy = buildContentSecurityPolicy({ nonce: "test", isProduction: true, storageOrigin: origin });
    expect(policy).toContain("connect-src 'self' https://storage.example.test:8443;");
    expect(policy).toContain("img-src 'self' data: blob: https://storage.example.test:8443;");
    expect(policy).toContain("object-src 'self' blob: https://storage.example.test:8443;");
    expect(policy).toContain("frame-src 'self' blob: https://storage.example.test:8443;");
    expect(policy).not.toContain("script-src 'self' https://storage");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("/path");
  });

  it("follows the driver: a virtual-hosted S3 bucket, a Supabase project, and nothing for local storage", () => {
    expect(storageOriginForCsp({ STORAGE_DRIVER: "s3", STORAGE_ENDPOINT: "https://s3.example.test", STORAGE_BUCKET: "models", STORAGE_FORCE_PATH_STYLE: "false" })).toBe("https://models.s3.example.test");
    expect(storageOriginForCsp({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://abcd.supabase.co" })).toBe("https://abcd.supabase.co");
    expect(storageOriginForCsp({ STORAGE_DRIVER: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co/" })).toBe("https://abcd.supabase.co");
    expect(storageOriginForCsp({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://abcd.supabase.co", SUPABASE_STORAGE_URL: "https://abcd.storage.supabase.co/storage/v1" })).toBe("https://abcd.storage.supabase.co");
    expect(storageOriginForCsp({ STORAGE_DRIVER: "local", STORAGE_ENDPOINT: "https://s3.example.test", SUPABASE_URL: "https://abcd.supabase.co" })).toBeUndefined();
    expect(storageOriginForCsp({})).toBeUndefined();
  });

  it.each(["https://*.example.test", "https://user:secret@example.test", "data:text/plain,abc", "https://host.test; connect-src *"])("does not emit an unsafe storage source: %s", (endpoint) => {
    expect(storageOriginForCsp({ STORAGE_DRIVER: "s3", STORAGE_ENDPOINT: endpoint })).toBeUndefined();
    expect(storageOriginForCsp({ STORAGE_DRIVER: "supabase", SUPABASE_URL: endpoint })).toBeUndefined();
    expect(buildContentSecurityPolicy({ nonce: "test", isProduction: false, storageOrigin: endpoint })).not.toContain(endpoint);
  });

  it("does not allow insecure storage in production", () => {
    const policy = buildContentSecurityPolicy({ nonce: "test", isProduction: true, storageOrigin: "http://localhost:9000" });
    expect(policy).not.toContain("http://localhost");
    expect(buildContentSecurityPolicy({ nonce: "test", isProduction: false, storageOrigin: "http://localhost:9000" })).toContain("connect-src 'self' http://localhost:9000");
  });

  it("lets signed-in pages decode compressed 3D models without permitting JavaScript eval", () => {
    const policy = buildContentSecurityPolicy({ nonce: "test", isProduction: true, threeDEnabled: true });
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("worker-src 'self' blob:");
    // Embedded GLB textures are fetched from blob: URLs; the Draco decoder is served from this origin.
    expect(policy).toContain("connect-src 'self' blob:");
    expect(policy).not.toContain("gstatic.com");
    const anonymous = buildContentSecurityPolicy({ nonce: "test", isProduction: true });
    expect(anonymous).not.toContain("wasm-unsafe-eval");
    expect(anonymous).toContain("connect-src 'self';");
  });

  it("keeps Mapbox origins closed when Project 3D map features are disabled", () => {
    const policy = buildContentSecurityPolicy({ nonce: "test-nonce", isProduction: true, mapboxEnabled: false });

    expect(policy).not.toContain("mapbox.com");
    expect(policy).toContain("worker-src 'self'");
    expect(policy).not.toContain("worker-src 'self' blob:");
  });

  it("allows only the public Mapbox browser endpoints needed by the 3D runtime", () => {
    const policy = buildContentSecurityPolicy({ nonce: "test-nonce", isProduction: true, mapboxEnabled: true });

    expect(policy).toContain("img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com");
    expect(policy).toContain("connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com");
    expect(policy).toContain("worker-src 'self' blob:");
  });
});
