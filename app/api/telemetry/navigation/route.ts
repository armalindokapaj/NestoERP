import { NextResponse } from "next/server";

import { apiError, withContext } from "@/lib/api/respond";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import {
  admitInstanceBatch,
  ingestNavigationBatch,
  navigationBatchSchema,
  TELEMETRY_MAX_BYTES,
  telemetryIngestionEnabled,
} from "@/lib/core/observability/navigation-telemetry";
import { checkRateLimit, hashSubject } from "@/lib/core/security/rate-limit";
import { assertPublicMutationOrigin } from "@/lib/modules/pricing/pricing.http";

/**
 * POST /api/telemetry/navigation — sampled browser navigation observations
 * (NAV-03 §11, TELEMETRY-03).
 *
 * Signed-in only, same origin only, normal maintenance enforcement. The body
 * is refused past 16 KiB while it is read, not after. At most six batches a
 * minute per session on this instance, and a per-instance ceiling. A valid
 * batch answers 204; nothing the browser sent is ever echoed. Browser samples
 * are observations only: they touch counters and histograms, never a
 * business record or an access decision.
 */

const noStore = { "cache-control": "private, no-store, max-age=0" };

async function readBounded(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > TELEMETRY_MAX_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > TELEMETRY_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(request: Request) {
  return withContext(
    async (context) => {
      assertPublicMutationOrigin(request);
      if (!telemetryIngestionEnabled()) return new NextResponse(null, { status: 204, headers: noStore });

      // The session decides the limit, never anything in the payload.
      const limit = checkRateLimit("TELEMETRY", await hashSubject(context.sessionId));
      if (!limit.allowed || !admitInstanceBatch()) {
        incrementCounter(Metric.TELEMETRY_BATCH, { outcome: "rate_limited" });
        return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many telemetry batches." } }, { status: 429, headers: { ...noStore, "retry-after": String(Math.max(1, limit.retryAfterSeconds)) } });
      }

      const text = await readBounded(request);
      if (text === null) {
        incrementCounter(Metric.TELEMETRY_BATCH, { outcome: "too_large" });
        return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "The batch is too large." } }, { status: 413, headers: noStore });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const batch = navigationBatchSchema.safeParse(parsed);
      if (!batch.success) {
        incrementCounter(Metric.TELEMETRY_BATCH, { outcome: "invalid" });
        return apiError("VALIDATION_ERROR", "The batch is not valid.");
      }
      ingestNavigationBatch(batch.data);
      incrementCounter(Metric.TELEMETRY_BATCH, { outcome: "accepted" });
      return new NextResponse(null, { status: 204, headers: noStore });
    },
    { group: "any" },
  );
}
