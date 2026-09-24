import { describe, expect, it } from "vitest";

import { describeLogo, isShellLogoSource, LOGO_DATA_URI_MAX, organizationInitials, resolveShellLogo } from "@/lib/workspace/branding";

/** The tenant's identity mark at the top of the sidebar (OW §12, §44, §51). */
describe("organizationInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(organizationInitials("ARMAAR GROUP")).toBe("AG");
    expect(organizationInitials("IDEAL Construction")).toBe("IC");
  });

  it("skips punctuation between words", () => {
    expect(organizationInitials("ARLIS - NDERTIM")).toBe("AN");
    expect(organizationInitials("K.F POGRADECI")).toBe("KF");
  });

  it("gives one letter for one word, keeps accents and upper-cases", () => {
    expect(organizationInitials("Klais")).toBe("K");
    expect(organizationInitials("ëndërr studio")).toBe("ËS");
  });

  it("never returns an empty mark", () => {
    expect(organizationInitials(" - ")).toBe("?");
  });
});

describe("isShellLogoSource", () => {
  it("accepts a path on this deployment", () => {
    expect(isShellLogoSource("/branding/armaar.svg")).toBe(true);
  });

  it("accepts a small inline image", () => {
    expect(isShellLogoSource("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isShellLogoSource("data:image/svg+xml;base64,PHN2Zy8+")).toBe(true);
  });

  it("refuses what the content security policy would block or what is not an image", () => {
    for (const value of [
      "https://cdn.example.com/logo.png",
      "//cdn.example.com/logo.png",
      "/\\evil.example.com/logo.png",
      "javascript:alert(1)",
      "data:text/html;base64,PGgxPg==",
      "data:image/png,not-base64",
      "branding/logo.svg",
      "/branding/my logo.svg",
    ]) {
      expect(isShellLogoSource(value), value).toBe(false);
    }
  });

  it("refuses API routes, which an image request would call with the viewer's cookies", () => {
    expect(isShellLogoSource("/api/auth/signout")).toBe(false);
    expect(isShellLogoSource("/API/anything")).toBe(false);
  });

  it("refuses an inline image past the size limit, and nothing at all", () => {
    expect(isShellLogoSource(`data:image/png;base64,${"A".repeat(LOGO_DATA_URI_MAX)}`)).toBe(false);
    expect(isShellLogoSource("")).toBe(false);
    expect(isShellLogoSource(null)).toBe(false);
  });
});

describe("resolveShellLogo (§12: group, then company, then initials)", () => {
  it("prefers the group's logo", () => {
    expect(resolveShellLogo({ groupLogoUrl: "/g.svg", companyLogoUrl: "/c.svg", inGroup: false })).toBe("/g.svg");
  });

  it("falls back to the company's in a company workspace", () => {
    expect(resolveShellLogo({ groupLogoUrl: null, companyLogoUrl: "/c.svg", inGroup: false })).toBe("/c.svg");
  });

  it("never lets one company's logo stand for the Group workspace", () => {
    expect(resolveShellLogo({ groupLogoUrl: null, companyLogoUrl: "/c.svg", inGroup: true })).toBeNull();
  });

  it("skips a stored value the shell could not draw", () => {
    expect(resolveShellLogo({ groupLogoUrl: "https://elsewhere.example/g.png", companyLogoUrl: "/c.svg", inGroup: false })).toBe("/c.svg");
  });
});

describe("describeLogo", () => {
  it("records a path as itself and an inline image by kind and size, never its bytes", () => {
    expect(describeLogo("/branding/a.svg")).toBe("/branding/a.svg");
    expect(describeLogo(`data:image/png;base64,${"A".repeat(4096)}`)).toBe("inline image/png, 3 KB");
    expect(describeLogo(null)).toBeNull();
  });
});
