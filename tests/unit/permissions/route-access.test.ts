import { describe, expect, it } from "vitest";

import {
  isContextlessRoute,
  isDeadSessionReason,
  isPublicRoute,
  PUBLIC_OPERATIONAL_ROUTES,
  redirectsWhenAuthenticated,
} from "@/lib/permissions/route-access";

/**
 * Route classification tests (PRD #6 §4, §5, §44).
 *
 * Middleware decides who may reach a route from these answers alone, so a
 * wrong one is either a lockout or an open door.
 */
describe("isPublicRoute", () => {
  it("admits the pages an anonymous visitor must reach", () => {
    for (const path of ["/", "/login", "/forgot-password", "/reset-password", "/pricing"]) {
      expect(isPublicRoute(path), path).toBe(true);
    }
  });

  it("keeps product routes private", () => {
    for (const path of ["/dashboard", "/projects", "/finance", "/settings"]) {
      expect(isPublicRoute(path), path).toBe(false);
    }
  });

  it("admits an invitation link but not the bare prefix", () => {
    expect(isPublicRoute("/invite/some-token")).toBe(true);
    expect(isPublicRoute("/invite/")).toBe(false);
    expect(isPublicRoute("/invite")).toBe(false);
  });

  /**
   * The probes (PRD #32 §119-§122).
   *
   * These were gated, and a gated readiness probe does not merely fail to
   * answer — it answers 307 before the handler runs, so it reports the same
   * thing whether the database is up or down. A probe that cannot say "not
   * ready" is not a probe.
   */
  it("admits the health probes, which have no session to offer", () => {
    for (const path of PUBLIC_OPERATIONAL_ROUTES) {
      expect(isPublicRoute(path), path).toBe(true);
    }
  });

  it("does not open the rest of the API along with them", () => {
    for (const path of ["/api/health", "/api/documents", "/api/projects", "/api/health/ready/x"]) {
      expect(isPublicRoute(path), path).toBe(false);
    }
  });
});

describe("redirectsWhenAuthenticated", () => {
  it("moves a signed-in visitor off the sign-in pages", () => {
    for (const path of ["/login", "/forgot-password", "/reset-password"]) {
      expect(redirectsWhenAuthenticated(path), path).toBe(true);
    }
  });

  it("leaves every other public page alone", () => {
    for (const path of ["/", "/pricing", "/invite/some-token"]) {
      expect(redirectsWhenAuthenticated(path), path).toBe(false);
    }
  });

  /**
   * The lockout this guards against (PRD #6 §51).
   *
   * A session cookie outlives the session row it names — revoked, expired, or
   * dropped by a database reseed. The page resolves no context and redirects to
   * /login?reason=session-expired; middleware still reads a valid cookie. If it
   * bounced them back to /dashboard the two would trade redirects forever and
   * the login page would never render, leaving the person no way to recover.
   */
  it("lets a rejected session land on the login page instead of looping", () => {
    expect(redirectsWhenAuthenticated("/login", "session-expired")).toBe(false);
    expect(redirectsWhenAuthenticated("/login", "account-unavailable")).toBe(false);
  });

  it("still redirects when the reason is absent or unrecognised", () => {
    expect(redirectsWhenAuthenticated("/login", null)).toBe(true);
    expect(redirectsWhenAuthenticated("/login", "")).toBe(true);
    expect(redirectsWhenAuthenticated("/login", "just-browsing")).toBe(true);
  });
});

describe("isDeadSessionReason", () => {
  it("recognises only the reasons the context resolver actually emits", () => {
    expect(isDeadSessionReason("session-expired")).toBe(true);
    expect(isDeadSessionReason("account-unavailable")).toBe(true);
    expect(isDeadSessionReason("company")).toBe(false);
    expect(isDeadSessionReason(null)).toBe(false);
    expect(isDeadSessionReason(undefined)).toBe(false);
  });
});

describe("isContextlessRoute", () => {
  it("keeps the workspace-unavailable page reachable without a context", () => {
    expect(isContextlessRoute("/workspace-unavailable")).toBe(true);
    expect(isContextlessRoute("/dashboard")).toBe(false);
  });
});
