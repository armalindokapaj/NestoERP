import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { endSessionAction } from "@/lib/actions/auth";
import { expireSession } from "@/lib/auth/session-store";
import { prisma } from "@/lib/database/prisma";

const headers = { "Cache-Control": "private, no-store" };

/** Deliberately independent of the active workspace, including platform sessions. */
export async function GET() {
  const user = (await auth())?.user;
  const row = user?.sessionId ? await prisma.session.findFirst({
    where: { id: user.sessionId, userId: user.id },
    select: { id: true, expiresAt: true },
  }) : null;
  const now = Date.now();
  if (row && row.expiresAt.getTime() <= now) await expireSession(row.id);
  if (!row || row.expiresAt.getTime() <= now || (await cookies()).has("nesto.signed-out")) {
    return NextResponse.json({ error: { code: "SESSION_EXPIRED" } }, { status: 401, headers });
  }
  return NextResponse.json({
    user: createHash("sha256").update(user!.id).digest("hex"),
    identity: createHash("sha256").update(row.id).digest("hex"),
    remainingMs: row.expiresAt.getTime() - now,
  }, { headers });
}

export async function POST(request: Request) {
  // This endpoint bypasses workspace authorization, never same-origin CSRF protection.
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  const origin = `${protocol}://${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  const result = await endSessionAction();
  return NextResponse.json(result, { status: result.ok ? 200 : 503, headers });
}
