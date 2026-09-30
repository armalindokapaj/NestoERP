import { describe, expect, it } from "vitest";

import { allowedNavigationHosts, resolveNativeOrigin } from "../../../native/origins";
import { compareVersions, compatibilityPolicy, evaluateCompatibility, parseAppUserAgent } from "@/lib/device/compatibility";
import { classifyLink, resolveDeepLink, safePushPath } from "@/lib/device/links";
import { hasCapability } from "@/lib/device/platform";

const APP = "https://www.rozaris.com";

describe("native origin per environment (MOB-08 §12)", () => {
  it("defaults to production and never to localhost", () => {
    expect(resolveNativeOrigin({})).toEqual({ environment: "production", origin: APP });
  });
  it("refuses a local or plain-http production/staging origin", () => {
    expect(() => resolveNativeOrigin({ NESTO_NATIVE_ENV: "production", NESTO_NATIVE_ORIGIN_PRODUCTION: "http://localhost:3000" })).toThrow();
    expect(() => resolveNativeOrigin({ NESTO_NATIVE_ENV: "staging", NESTO_NATIVE_ORIGIN_STAGING: "https://192.168.1.4" })).toThrow();
    expect(() => resolveNativeOrigin({ NESTO_NATIVE_ENV: "staging", NESTO_NATIVE_ORIGIN_STAGING: "http://staging.example.com" })).toThrow();
  });
  it("requires an explicit staging origin", () => {
    expect(() => resolveNativeOrigin({ NESTO_NATIVE_ENV: "staging" })).toThrow(/STAGING/);
    expect(resolveNativeOrigin({ NESTO_NATIVE_ENV: "staging", NESTO_NATIVE_ORIGIN_STAGING: "https://staging.example.com/x" }).origin).toBe("https://staging.example.com");
  });
  it("lets development use a local dev server", () => {
    expect(resolveNativeOrigin({ NESTO_NATIVE_ENV: "development" }).origin).toBe("http://localhost:3000");
  });
  it("rejects an unknown environment", () => {
    expect(() => resolveNativeOrigin({ NESTO_NATIVE_ENV: "prod" })).toThrow();
  });
  it("allows navigation to the NESTO host only", () => {
    expect(allowedNavigationHosts(APP)).toEqual(["www.rozaris.com"]);
  });
});

describe("link handling (MOB-08 §30, §31, §52, §53)", () => {
  it("classifies links", () => {
    expect(classifyLink("/tasks/1", APP)).toBe("internal");
    expect(classifyLink(`${APP}/projects/2`, APP)).toBe("internal");
    expect(classifyLink("https://example.com", APP)).toBe("external-web");
    expect(classifyLink("tel:+355000", APP)).toBe("tel");
    expect(classifyLink("mailto:a@b.co", APP)).toBe("mailto");
    expect(classifyLink("javascript:alert(1)", APP)).toBe("blocked");
    expect(classifyLink("http://example.com", APP)).toBe("blocked");
    expect(classifyLink("file:///etc/passwd", APP)).toBe("blocked");
  });
  it("resolves a NESTO deep link to a path and nothing else", () => {
    expect(resolveDeepLink(`${APP}/tasks/abc?tab=files#c1`, APP)).toBe("/tasks/abc?tab=files#c1");
    expect(resolveDeepLink("https://evil.example/tasks/abc", APP)).toBeNull();
    expect(resolveDeepLink(`${APP}/api/auth/signout`, APP)).toBeNull();
    expect(resolveDeepLink("not a url", APP)).toBeNull();
  });
  it("accepts a push path only when it is an in-app absolute path", () => {
    expect(safePushPath("/approvals/9")).toBe("/approvals/9");
    for (const bad of ["//evil.example", "https://evil.example", "/api/x", "\\\\x", 5, undefined]) expect(safePushPath(bad)).toBeNull();
  });
});

describe("version compatibility (MOB-08 §66-§68)", () => {
  const policy = compatibilityPolicy({ NESTO_MIN_APP_VERSION: "1.2.0", NESTO_RECOMMENDED_APP_VERSION: "1.4.0" });
  it("parses the app user agent", () => {
    expect(parseAppUserAgent("Mozilla/5.0 NESTOApp/1.3.2 (ios; build 104)")).toEqual({ version: "1.3.2", platform: "ios", build: 104 });
    expect(parseAppUserAgent("Mozilla/5.0 Safari")).toBeNull();
  });
  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
  });
  it("requires, recommends or accepts by version", () => {
    expect(evaluateCompatibility("1.1.9", "ios", policy).status).toBe("update-required");
    expect(evaluateCompatibility("1.3.0", "android", policy).status).toBe("update-recommended");
    expect(evaluateCompatibility("1.4.0", "ios", policy).status).toBe("ok");
  });
  it("never recommends below the minimum, and ignores malformed policy", () => {
    expect(compatibilityPolicy({ NESTO_MIN_APP_VERSION: "2.0.0", NESTO_RECOMMENDED_APP_VERSION: "1.0.0" }).recommended).toBe("2.0.0");
    expect(compatibilityPolicy({ NESTO_MIN_APP_VERSION: "latest" }).minimum).toBe("1.0.0");
  });
});

describe("capability flags (MOB-08 §77)", () => {
  it("has no native capability on the web", () => {
    expect(hasCapability("push", "web")).toBe(false);
  });
  it("gives both native platforms the same capabilities, except the Android Back button", () => {
    for (const c of ["push", "biometrics", "secureStorage", "nativeShare", "nativeCamera", "nativeFilePicker"] as const) {
      expect(hasCapability(c, "ios")).toBe(true);
      expect(hasCapability(c, "android")).toBe(true);
    }
    expect(hasCapability("backButton", "ios")).toBe(false);
    expect(hasCapability("backButton", "android")).toBe(true);
  });
});
