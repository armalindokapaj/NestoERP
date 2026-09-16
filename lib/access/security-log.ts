import { defaultSecurityReason, type ApiErrorCode, type SecurityReasonCode } from "@/lib/access/guards";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";

/**
 * Authorisation denials, as operational signal (PRD #47 §117-§119, §196, §197).
 *
 * A denial is not a business event, so it goes to the security log rather than
 * the immutable audit trail. The line carries the request id, company and
 * member (added by the logger from the request context), the public code and
 * the internal reason — never the record's content, title or the permission
 * that was missing (§199).
 *
 * The counters are what an alert watches: a sudden rise in cross-company
 * denials is either somebody probing ids or a client sending the wrong ones
 * (§197).
 */
export function recordAuthorizationDenial(input: { code: ApiErrorCode; reason?: SecurityReasonCode; resource?: string; action?: string }): void {
  const reason = input.reason ?? defaultSecurityReason(input.code);
  if (!reason) return;

  incrementCounter(Metric.AUTHORIZATION_DENIED, { reason });
  if (reason === "CROSS_COMPANY_REFERENCE") incrementCounter(Metric.CROSS_COMPANY_DENIED);
  if (reason === "CROSS_PROJECT_REFERENCE") incrementCounter(Metric.CROSS_PROJECT_DENIED);
  if (reason === "MODULE_DISABLED") incrementCounter(Metric.MODULE_DISABLED_DENIED);
  if (reason === "PERMISSION_DENIED") incrementCounter(Metric.PERMISSION_DENIED);

  // A 404 is also the everyday answer to a stale link, so it is recorded
  // quietly; everything else is somebody reaching for what is not theirs.
  const level = reason === "RECORD_DENIED" ? "info" : "warn";
  logger[level]("security.authorization_denied", {
    code: input.code,
    reasonCode: reason,
    ...(input.resource ? { resource: input.resource } : {}),
    ...(input.action ? { action: input.action } : {}),
  });
}
