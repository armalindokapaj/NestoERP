import { NextResponse } from "next/server";

/**
 * Android App Links (MOB-08 §29). `NESTO_ANDROID_SHA256_CERTS` is the
 * comma-separated SHA-256 fingerprint(s) of the release (and Play App Signing)
 * certificate. Not configured → 404, never a file that verifies nothing.
 */
export async function GET() {
  const fingerprints = (process.env.NESTO_ANDROID_SHA256_CERTS ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
  if (fingerprints.length === 0) return new NextResponse(null, { status: 404 });
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: process.env.NESTO_ANDROID_PACKAGE ?? "com.nesto.erp", sha256_cert_fingerprints: fingerprints },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
