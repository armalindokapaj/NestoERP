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

/** `process.env`, or the part of it that names the object store. */
type StorageEnv = Readonly<Record<string, string | undefined>>;

/**
 * The object store's own origin, when browsers talk to it directly: the S3
 * endpoint (or its virtual-hosted bucket host) or the Supabase project. Only
 * that origin — never a wildcard, a path, credentials or a signed URL. The local
 * driver answers on this origin, so it needs nothing.
 */
export function storageOriginForCsp(env: StorageEnv): string | undefined {
  if (env.STORAGE_DRIVER === "s3") {
    const bucketHost = env.STORAGE_FORCE_PATH_STYLE === "false" ? env.STORAGE_BUCKET : undefined;
    if (bucketHost !== undefined && !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucketHost)) return undefined;
    return safeOrigin(env.STORAGE_ENDPOINT, bucketHost);
  }
  if (env.STORAGE_DRIVER === "supabase") {
    return safeOrigin(env.SUPABASE_STORAGE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  }
  return undefined;
}

function safeOrigin(value: string | undefined, hostPrefix?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hostname.includes("*")) return undefined;
    if (hostPrefix) url.hostname = `${hostPrefix}.${url.hostname}`;
    return url.origin;
  } catch {
    return undefined;
  }
}

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
 *
 * `storageOrigin` is the private bucket's origin (`storageOriginForCsp`): the
 * browser uploads to it and reads previews, downloads and 3D models from it
 * through short-lived signed URLs. Production accepts it over HTTPS only.
 *
 * `threeDEnabled` is for signed-in documents, because a CSP belongs to the
 * document and a client-side navigation can reach the 3D viewer or editor from
 * any page. The renderer compiles WebAssembly (the Draco and Meshopt geometry
 * decoders: `'wasm-unsafe-eval'`, which allows no JavaScript eval), decodes in
 * `blob:` workers, and three.js fetches a GLB's embedded textures from `blob:`
 * URLs. The Draco decoder itself is served from this origin.
 */
export function buildContentSecurityPolicy(options: {
  nonce: string;
  isProduction: boolean;
  mapboxEnabled?: boolean;
  threeDEnabled?: boolean;
  storageOrigin?: string;
}): string {
  const scriptSrc = options.isProduction
    ? `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${options.threeDEnabled ? " 'wasm-unsafe-eval'" : ""}`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`;

  const mapboxImages = options.mapboxEnabled ? " https://api.mapbox.com https://*.tiles.mapbox.com" : "";
  const mapboxConnections = options.mapboxEnabled ? " https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com" : "";
  const storageOrigin = options.storageOrigin ? safeOrigin(options.storageOrigin) : undefined;
  const storage = storageOrigin && (!options.isProduction || storageOrigin.startsWith("https://")) ? ` ${storageOrigin}` : "";
  const modelConnections = options.threeDEnabled ? " blob:" : "";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // `blob:` covers a preview rendered from bytes the page already holds.
    // Mapbox image origins are added only for deployments that configure it.
    `img-src 'self' data: blob:${mapboxImages}${storage}`,
    `media-src 'self' blob:${storage}`,
    "font-src 'self' data:",
    `connect-src 'self'${mapboxConnections}${storage}${modelConnections}`,
    options.mapboxEnabled || options.threeDEnabled ? "worker-src 'self' blob:" : "worker-src 'self'",
    // A document preview is framed from this origin, or the private bucket's (PRD #29 §200).
    `frame-src 'self' blob:${storage}`,
    `object-src 'self' blob:${storage}`,
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
