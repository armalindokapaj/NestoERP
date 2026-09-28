import type { NextConfig } from "next";

/**
 * Security headers (PRD #30 §105-§117, PRD #35 §86).
 *
 * The browser is not a security boundary, but these close off whole classes of
 * attack cheaply: CSP restricts where scripts and connections may come from,
 * frame-ancestors blocks clickjacking, nosniff stops MIME confusion, and HSTS
 * keeps production on TLS (PRD #30 §106, §112, §114).
 *
 * The Content-Security-Policy itself is *not* here. It carries a per-request
 * nonce, so it is built in `lib/core/security/csp.ts` and set by middleware —
 * a static `script-src 'self'` would block Next's own bootstrap scripts and
 * serve a blank page (PRD #30 §108). Everything below is genuinely static.
 */
const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  /**
   * Build directory (PRD #34 §51).
   *
   * Overridable so a production build can be told to write somewhere other than
   * `.next`. Two servers sharing one build directory corrupt each other: a
   * `next build` run while a `next dev` server is up replaces the manifests that
   * server is reading, and every route then answers 500 with no useful error.
   * The E2E script sets this, so a production run cannot disturb a dev server.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  // The floating dev badge sits on top of the sidebar footer; the build output
  // and error overlay are unaffected.
  devIndicators: false,

  // Source maps stay private: they are uploaded to the error monitor, never
  // served to the public (PRD #30 §259, PRD #34 §51).
  productionBrowserSourceMaps: false,

  /**
   * On Vercel the build compiles only. Linting and type-checking the whole
   * repository after Turbopack's compile ran the 8 GB build machine out of
   * memory (a1cae587, `out_of_memory`), and CI already runs `pnpm lint` and
   * `pnpm typecheck` as their own steps. Local builds still check both.
   */
  eslint: { ignoreDuringBuilds: process.env.VERCEL === "1" },
  typescript: { ignoreBuildErrors: process.env.VERCEL === "1" },

  /**
   * `/legal` is the same module as `/contracts` (PRD #18 §8).
   *
   * Older shell configuration used `/legal` as the route for this module. It
   * resolves to the canonical one rather than being maintained beside it: two
   * legal modules that can disagree is the failure this redirect exists to
   * prevent.
   */
  async redirects() {
    return [
      { source: "/legal", destination: "/contracts", permanent: true },
      { source: "/legal/:path*", destination: "/contracts/:path*", permanent: true },
      // Platform Admin moved to /admin (Admin IA §6, §49, §50). Temporary, so a
      // later rework can re-home these without browsers holding stale 308s.
      ...[
        ["/platform-admin/overview", "/admin"],
        ["/platform-admin/dashboard", "/admin"],
        ["/platform-admin/groups/:id/departments", "/admin/organizations/:id/departments"],
        ["/platform-admin/groups/:id", "/admin/organizations/:id"],
        ["/platform-admin/organizations/groups", "/admin/organizations"],
        ["/platform-admin/organizations/companies/:id", "/admin/organizations/:id"],
        ["/platform-admin/organizations/projects", "/admin/projects"],
        ["/platform-admin/access/users", "/admin/users"],
        ["/platform-admin/access/:path*", "/admin/users/:path*"],
        ["/platform-admin/people", "/admin/users/people"],
        ["/platform-admin/security/sessions", "/admin/users/sessions"],
        ["/platform-admin/security/audit", "/admin/audit/security"],
        ["/platform-admin/security/:path*", "/admin/audit/:path*"],
        ["/platform-admin/product/modules", "/admin/modules"],
        ["/platform-admin/product/:path*", "/admin/modules/:path*"],
        ["/platform-admin/pricing", "/admin/modules/pricing"],
        ["/platform-admin/settings/:path*", "/admin/system/:path*"],
        ["/platform-admin/settings", "/admin/system"],
        ["/platform-admin/operations/:path*", "/admin/system/:path*"],
        ["/platform-admin/data/:path*", "/admin/system/:path*"],
        ["/platform-admin/support", "/admin/system/support"],
        ["/platform-admin/demo", "/admin/system/demo"],
        ["/platform-admin", "/admin"],
        ["/platform-admin/:path*", "/admin/:path*"],
        ["/admin/overview", "/admin"],
        ["/admin/dashboard", "/admin"],
      ].map(([source, destination]) => ({ source, destination, permanent: false })),
    ];
  },

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Nothing authenticated may be cached by a shared proxy (PRD #30 §214).
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
