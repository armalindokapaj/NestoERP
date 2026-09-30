/**
 * Reading and comparing NESTO app versions. Lives with the security policy
 * because the policy is written in these terms (minimum version, blocked
 * builds), and is re-exported by `lib/device/compatibility.ts` for the code
 * that already imports it from there.
 */

/**
 * The native binary appends `NESTOApp/<version> (<platform>; build <n>)` to its
 * user agent (capacitor.config.ts), so the server sees which binary is talking
 * without any per-request header plumbing in shared code.
 */
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
