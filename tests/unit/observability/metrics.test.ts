import { beforeEach, describe, expect, it } from "vitest";

import { counterValue, incrementCounter, Metric, renderPrometheus, resetMetrics } from "@/lib/core/observability/metrics";

describe("metrics (PRD #38 §105-§108)", () => {
  beforeEach(() => resetMetrics());

  it("counts per label set and renders the Prometheus text format", () => {
    incrementCounter(Metric.MAIL_SEND_SUCCESS, { template: "auth.password_reset", provider: "memory" });
    incrementCounter(Metric.MAIL_SEND_SUCCESS, { provider: "memory", template: "auth.password_reset" });
    incrementCounter(Metric.MAIL_SEND_FAILURE, { template: "team.invitation", provider: "resend" });

    expect(counterValue(Metric.MAIL_SEND_SUCCESS, { template: "auth.password_reset", provider: "memory" })).toBe(2);

    const text = renderPrometheus([{ name: "notification_outbox_pending", value: 4, help: "pending" }]);
    expect(text).toContain("# TYPE mail_send_success_count counter");
    expect(text).toContain('mail_send_success_count{template="auth.password_reset",provider="memory"} 2');
    expect(text).toContain("# TYPE notification_outbox_pending gauge");
    expect(text).toContain("notification_outbox_pending 4");
  });

  it("escapes label values", () => {
    incrementCounter(Metric.WORKER_JOB_FAILURE, { job: 'a"b\\c' });
    expect(renderPrometheus()).toContain('job="a\\"b\\\\c"');
  });
});
