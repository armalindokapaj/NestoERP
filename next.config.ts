import type { NextConfig } from "next";

/**
 * Security headers (PRD #30 §105-§117, PRD #35 §86).
 *
 * The browser is not a security boundary, but these close off whole classes of
 * attack cheaply: CSP restricts where scripts and connections may come from,
 * frame-ancestors blocks clickjacking, nosniff stops MIME confusion, and HSTS
 * keeps production on TLS (PRD #30 §106, §112, §114).
 *
 * `unsafe-inline` for styles is Next.js's styled-jsx requirement; scripts do not
 * get it in production (PRD #30 §107, §108).
 */
const isProduction = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  isProduction ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
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
  // The floating dev badge sits on top of the sidebar footer; the build output
  // and error overlay are unaffected.
  devIndicators: false,

  // Source maps stay private: they are uploaded to the error monitor, never
  // served to the public (PRD #30 §259, PRD #34 §51).
  productionBrowserSourceMaps: false,

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
