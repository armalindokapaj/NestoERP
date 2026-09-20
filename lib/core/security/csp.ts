/**
 * Content-Security-Policy with a per-request nonce (PRD #30 §105-§117,
 * PRD #35 §86).
 *
 * `script-src 'self'` alone is not enough for a Next.js application, and the
 * failure is total rather than partial: the framework injects inline bootstrap
 * scripts on every page, the browser refuses them, hydration never runs, and
 * React tears the server-rendered markup down. A production build with that
 * policy serves a blank page.
 *
 * The answer is not `'unsafe-inline'` — that would hand back exactly the
 * protection the header exists for. It is a nonce: middleware mints one per
 * request, puts it in the policy, and Next stamps it onto its own script tags.
 * Inline script the application did not author still has no way to run.
 *
 * Built here rather than in `next.config.ts` because a nonce cannot be static.
 */

export const CSP_NONCE_HEADER = "x-nesto-csp-nonce";

/** 128 bits, base64, fresh for every request (PRD #30 §108). */
export function newCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The policy.
 *
 * `style-src` keeps `'unsafe-inline'`: Next injects styles inline and there is
 * no nonce path for them, which is a documented and much narrower exposure
 * than script execution (PRD #30 §107).
 *
 * Development also allows `'unsafe-eval'`, because the dev server's fast
 * refresh needs it. Production does not (PRD #30 §108).
 */
export function buildContentSecurityPolicy(options: {
  nonce: string;
  isProduction: boolean;
  mapboxEnabled?: boolean;
}): string {
  const scriptSrc = options.isProduction
    ? `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`;

  const mapboxImages = options.mapboxEnabled ? " https://api.mapbox.com https://*.tiles.mapbox.com" : "";
  const mapboxConnections = options.mapboxEnabled ? " https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com" : "";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // `blob:` covers a preview rendered from bytes the page already holds.
    // Mapbox image origins are added only for deployments that configure it.
    `img-src 'self' data: blob:${mapboxImages}`,
    "font-src 'self' data:",
    `connect-src 'self'${mapboxConnections}`,
    options.mapboxEnabled ? "worker-src 'self' blob:" : "worker-src 'self'",
    // A document preview is framed from this origin only (PRD #29 §200).
    "frame-src 'self' blob:",
    "object-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
