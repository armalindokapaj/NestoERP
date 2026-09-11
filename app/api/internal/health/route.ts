import { NextResponse } from "next/server";

import { prisma } from "@/lib/database/prisma";
import { withContext } from "@/lib/api/respond";
import { assertPermission } from "@/lib/access/guards";

export const dynamic = "force-dynamic";

type DependencyState = "UP" | "DEGRADED" | "DOWN";

/**
 * Detailed health (PRD #32 §123-§128).
 *
 * Behind authentication and a company-management permission, because it names
 * dependencies and versions (PRD #32 §125, PRD #30 §269).
 */
export async function GET() {
  return withContext(async (context) => {
    assertPermission(context, "company.security_settings.view");

    let database: DependencyState = "UP";
    const startedAt = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "DOWN";
    }

    const overall: DependencyState = database === "DOWN" ? "DOWN" : "UP";

    return NextResponse.json({
      status: overall,
      dependencies: {
        database: { state: database, latencyMs: Date.now() - startedAt },
      },
      version: process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "dev",
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.round(process.uptime()),
    });
  });
}
