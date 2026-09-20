import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "@/lib/core/security/csp";

describe("Content Security Policy", () => {
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
