import { NextResponse } from "next/server";

/**
 * iOS Universal Links (MOB-08 §28). Serves the association file only when the
 * Apple Team ID is configured — a half-configured file would claim links the
 * build cannot verify. Every NESTO page path opens the app except the API and
 * Next internals, so the same canonical URL works with and without the app.
 */
export async function GET() {
  const team = process.env.NESTO_IOS_TEAM_ID;
  const bundle = process.env.NESTO_IOS_BUNDLE_ID ?? "com.nesto.erp";
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) return new NextResponse(null, { status: 404 });
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${team}.${bundle}`],
            components: [{ "/": "/api/*", exclude: true }, { "/": "/_next/*", exclude: true }, { "/": "/*" }],
          },
        ],
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
