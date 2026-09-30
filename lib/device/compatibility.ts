/**
 * App-version compatibility contract (MOB-08 §63-§68, §66).
 *
 * The native binary appends `NESTOApp/<version> (<platform>; build <n>)` to its
 * user agent (capacitor.config.ts), so the server sees which binary is talking
 * without any per-request header plumbing in shared code. Pure functions so
 * middleware, the API route and the client banner share one rule.
 */
export type AppCompatibility = {
  platform: "ios" | "android";
  version: string;
  minimumSupportedAppVersion: string;
  recommendedAppVersion: string;
  status: "ok" | "update-recommended" | "update-required";
};

const UA = /NESTOApp\/(\d+\.\d+\.\d+)\s*\((ios|android);\s*build\s*(\d+)\)/i;

export function parseAppUserAgent(userAgent: string | null | undefined): { version: string; platform: "ios" | "android"; build: number } | null {
  const match = userAgent ? UA.exec(userAgent) : null;
  if (!match) return null;
  return { version: match[1]!, platform: match[2]!.toLowerCase() as "ios" | "android", build: Number(match[3]) };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type CompatibilityPolicy = { minimum: string; recommended: string };

const VERSION = /^\d+\.\d+\.\d+$/;

/** Policy from the environment, so raising it is a config change, not a deploy of native code. */
export function compatibilityPolicy(env: Readonly<Record<string, string | undefined>>): CompatibilityPolicy {
  const minimum = env.NESTO_MIN_APP_VERSION && VERSION.test(env.NESTO_MIN_APP_VERSION) ? env.NESTO_MIN_APP_VERSION : "1.0.0";
  const recommended = env.NESTO_RECOMMENDED_APP_VERSION && VERSION.test(env.NESTO_RECOMMENDED_APP_VERSION) ? env.NESTO_RECOMMENDED_APP_VERSION : minimum;
  return { minimum, recommended: compareVersions(recommended, minimum) < 0 ? minimum : recommended };
}

export function evaluateCompatibility(version: string, platform: "ios" | "android", policy: CompatibilityPolicy): AppCompatibility {
  const status = compareVersions(version, policy.minimum) < 0 ? "update-required" : compareVersions(version, policy.recommended) < 0 ? "update-recommended" : "ok";
  return { platform, version, minimumSupportedAppVersion: policy.minimum, recommendedAppVersion: policy.recommended, status };
}
