/**
 * Which NESTO origin each native build loads (MOB-08 §12, §13, §53).
 *
 * The shell is a hosted one: its WebView opens the canonical NESTO origin, so
 * there is exactly one of these per build environment. A production build can
 * never resolve to localhost or a plain-http origin — `resolveNativeOrigin`
 * throws instead of producing a config that ships a developer URL.
 *
 * Plain TypeScript with no imports so `capacitor.config.ts` and the unit tests
 * can both load it.
 */
export type NativeEnvironment = "development" | "staging" | "production";

export const PRODUCTION_ORIGIN = "https://www.rozaris.com";

export type NativeEnv = Readonly<Record<string, string | undefined>>;

export function nativeEnvironment(env: NativeEnv): NativeEnvironment {
  const value = env.NESTO_NATIVE_ENV ?? "production";
  if (value === "development" || value === "staging" || value === "production") return value;
  throw new Error(`NESTO_NATIVE_ENV must be development, staging or production (got "${value}")`);
}

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "10.0.2.2" || hostname.endsWith(".local") || /^192\.168\./.test(hostname);
}

export function resolveNativeOrigin(env: NativeEnv): { environment: NativeEnvironment; origin: string } {
  const environment = nativeEnvironment(env);
  const raw =
    environment === "production"
      ? (env.NESTO_NATIVE_ORIGIN_PRODUCTION ?? PRODUCTION_ORIGIN)
      : environment === "staging"
        ? env.NESTO_NATIVE_ORIGIN_STAGING
        : (env.NESTO_NATIVE_ORIGIN_DEVELOPMENT ?? "http://localhost:3000");
  if (!raw) throw new Error(`NESTO_NATIVE_ORIGIN_${environment.toUpperCase()} is required for a ${environment} build`);
  const url = new URL(raw);
  if (environment !== "development" && (url.protocol !== "https:" || isLocal(url.hostname))) {
    throw new Error(`A ${environment} native build must load an https, non-local origin (got ${url.origin})`);
  }
  return { environment, origin: url.origin };
}

/** Hosts the WebView may navigate to: the NESTO origin only. Everything else is handed to the system browser. */
export function allowedNavigationHosts(origin: string): string[] {
  return [new URL(origin).host];
}
