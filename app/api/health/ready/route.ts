import { NextResponse } from "next/server";

import { prisma } from "@/lib/database/prisma";
import { logger, serialiseError } from "@/lib/core/observability/logger";

export const dynamic = "force-dynamic";

/**
 * Readiness (PRD #32 §119-§122, PRD #34 §129).
 *
 * An instance is ready when it can reach the database and its required config
 * resolved. Optional dependencies degrading must not take the whole instance out
 * of rotation (PRD #32 §121, §198).
 *
 * The response stays minimal whatever happens — a probe is not a diagnostic
 * channel for the public internet (PRD #30 §268).
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    logger.error("health.ready.failed", serialiseError(error));
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
