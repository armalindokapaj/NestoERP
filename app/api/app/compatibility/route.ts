import { NextResponse } from "next/server";

import { minimumSyncProtocolVersion, SYNC_PROTOCOL_VERSION } from "@/lib/core/sync/protocol";
import { compatibilityPolicy, evaluateCompatibility, parseAppUserAgent } from "@/lib/device/compatibility";

const headers = { "Cache-Control": "no-store" };

/** The offline sync protocol this server speaks, so a device knows before it replays anything (MOB-09 §109). */
const sync = () => ({ protocolVersion: SYNC_PROTOCOL_VERSION, minimumProtocolVersion: minimumSyncProtocolVersion() });

/**
 * GET /api/app/compatibility — does this installed binary still work here?
 * (MOB-08 §66-§68.) Public on purpose: an obsolete app has to be told to update
 * before it can sign in. It reads the version from the app's own user agent
 * (or `?version=&platform=` for tests) and returns the policy, nothing more.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseAppUserAgent(request.headers.get("user-agent"));
  const version = url.searchParams.get("version") ?? parsed?.version;
  const platformParam = url.searchParams.get("platform") ?? parsed?.platform;
  const platform = platformParam === "ios" || platformParam === "android" ? platformParam : null;
  const policy = compatibilityPolicy(process.env);
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !platform) {
    // Not a native app (a browser): nothing to gate.
    return NextResponse.json({ status: "ok", minimumSupportedAppVersion: policy.minimum, recommendedAppVersion: policy.recommended, sync: sync() }, { headers });
  }
  return NextResponse.json({ ...evaluateCompatibility(version, platform, policy), sync: sync() }, { headers });
}
