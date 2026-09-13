import { NextResponse } from "next/server";

import { prisma } from "@/lib/database/prisma";
import { jobHealth } from "@/lib/core/jobs/job.health";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";

export const dynamic = "force-dynamic";

/**
 * Readiness (PRD #32 §119-§122, PRD #34 §129).
 *
 * An instance is ready when it can reach the database and its required config
 * resolved. Optional dependencies degrading must not take the whole instance out
 * of rotation (PRD #32 §121, §198).
 *
 * The response stays minimal whatever happens — a probe is not a diagnostic
 * channel for the public internet (PRD #30 §268). In particular it never names
 * the bucket, the endpoint or the provider (PRD #29 §398).
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    /*
     * Object storage is checked too, because an instance that cannot reach the
     * bucket cannot serve a document (PRD #29 §397). It is reported separately
     * rather than folded into readiness: a storage outage degrades files, and
     * taking every instance out of rotation over it would turn a partial
     * failure into a total one (PRD #32 §121).
     */
    const storage = await storageProvider()
      .healthCheck()
      .catch(() => ({ ok: false }));

    if (!storage.ok) logger.error("health.storage.unreachable", {});

    /*
     * Background work is reported, not required (PRD #38 §104): a web instance
     * can serve requests while the worker is down, but notifications, scans and
     * attention stop moving, and that has to be visible. One word only — which
     * job is behind is for the metrics endpoint, not a public probe.
     */
    const jobs = await jobHealth().catch(() => null);
    const workers = !jobs
      ? "unknown"
      : jobs.every((job) => job.state === "never_run")
        ? "not_running"
        : jobs.some((job) => job.state === "failing" || job.state === "stale")
          ? "degraded"
          : "ok";

    return NextResponse.json({ status: "ok", storage: storage.ok ? "ok" : "degraded", workers });
  } catch (error) {
    logger.error("health.ready.failed", serialiseError(error));
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
