import { machineRequestAllowed } from "@/lib/core/observability/machine-auth";
import { renderPrometheus } from "@/lib/core/observability/metrics";
import { operationalGauges } from "@/lib/core/observability/operational-gauges";

export const dynamic = "force-dynamic";

/**
 * Prometheus metrics (PRD #38 §97, §105-§108).
 *
 * Counters are this instance's; gauges are the deployment's, read from the
 * database. Bearer-token only, and absent entirely without `METRICS_TOKEN`.
 * Nothing here names a company, a person or a record.
 */
export async function GET(request: Request) {
  if (!machineRequestAllowed(request, process.env.METRICS_TOKEN)) {
    return new Response("Not found", { status: 404 });
  }
  const body = renderPrometheus(await operationalGauges());
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store" },
  });
}
