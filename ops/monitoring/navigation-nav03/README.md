# NAV-03 navigation monitoring

This is the checked-in monitoring configuration the NAV-03 PRD asks for in
§11, TELEMETRY-05. It targets the Prometheus-compatible endpoint the app
already has, `GET /api/internal/metrics`. That endpoint needs
`Authorization: Bearer $METRICS_TOKEN` and answers 404 without it.

## What is exported

| Family | Kind | Labels | Source |
| --- | --- | --- | --- |
| `navigation_duration_ms` | histogram | route, stage, kind | sampled browsers: successful stages only |
| `navigation_outcome_total` | counter | route, stage, outcome | sampled browsers: every outcome, including timeout, superseded, abandoned and backgrounded |
| `panel_ready_ms` | histogram | panel, cache | sampled browsers |
| `panel_outcome_total` | counter | panel, stage, outcome | sampled browsers |
| `web_vital`, `web_vital_cls` | histogram | metric, device | sampled browsers, document Web Vitals only |
| `browser_request_total` | counter | family | sampled browsers |
| `activity_read_ms` | histogram | family, outcome | the server |
| `telemetry_batch_total` | counter | outcome | the server: accepted, invalid, too large, rate limited |

- **Labels:** every label value is one of a fixed set declared in
  `lib/core/observability/metrics.ts`, so browser input cannot add a series.
- **Series budget:** at most about 2,500 histogram series per instance. That
  is checked in `tests/unit/observability/navigation-telemetry.test.ts`
  against a budget of 4,000.
- **Sampling:** browser samples are 10 % of documents by default
  (`NESTO_NAV_TELEMETRY_SAMPLE`).

## Running it

- **Collector:** point a Prometheus at the app instances with `prometheus.yml`.
  `navigation-rules.yml` holds the five views as recording rules, plus the
  initial alerts.
- **Retention:** keep 30 days of aggregates. No raw browser payload is
  stored anywhere.
- **Staging:** run one local Prometheus against the staging instances. A
  release must show a scrape and a histogram query returning results
  (release evidence §7).
- **Across instances:** percentiles are computed from summed buckets. Never
  average per-instance p95s, and never divide `_sum` by `_count` to get p95.

## Switches

| Variable | Effect |
| --- | --- |
| `NESTO_NAV_TELEMETRY=off` | Browsers record nothing, and the endpoint drops batches with 204 |
| `NESTO_NAV_TELEMETRY_SAMPLE=0.1` | The share of documents that record |
| `NESTO_INTENT_PREFETCH=off` | The approved sidebar links and the NESTO logos stop preparing their destinations on hover or focus |

## Rate limits

- **Per session:** six batches a minute on each instance. A limiter failure
  refuses.
- **Per instance:** a ceiling of 1,200 batches a minute.
- **What these are not:** they are not a global quota. With more than one
  instance, set an aggregate cap at the edge.
