import { logger } from "@/lib/core/observability/logger";

/**
 * Rate limiting (PRD #30 §127-§138).
 *
 * A fixed-window counter held in process memory. That is honest about what it
 * is: correct for a single instance, and the thing to replace with Redis or an
 * edge limiter the moment NESTO runs more than one (PRD #30 §135, §136,
 * PRD #31 §206, §302).
 *
 * Authentication limits fail closed — if the limiter itself breaks, the request
 * is refused rather than waved through (PRD #30 §190, PRD #31 §232).
 */

export type RateLimitCategory =
  | "AUTH"
  | "WRITE"
  | "SEARCH"
  | "EXPORT"
  | "UPLOAD"
  | "DOWNLOAD_GRANT"
  | "GENERAL_API"
  | "PUBLIC_PRICING"
  | "PUBLIC_PRICING_LEAD"
  /** Browser navigation telemetry batches, per session, per instance (NAV-03 TELEMETRY-03). */
  | "TELEMETRY";

type Rule = { limit: number; windowMs: number; failClosed: boolean };

/** Starting points, to be tuned against real traffic (PRD #30 §130). */
const RULES: Record<RateLimitCategory, Rule> = {
  AUTH: { limit: 5, windowMs: 15 * 60_000, failClosed: true },
  WRITE: { limit: 120, windowMs: 60_000, failClosed: false },
  SEARCH: { limit: 120, windowMs: 60_000, failClosed: false },
  EXPORT: { limit: 10, windowMs: 10 * 60_000, failClosed: false },
  UPLOAD: { limit: 50, windowMs: 60_000, failClosed: false },
  DOWNLOAD_GRANT: { limit: 120, windowMs: 60_000, failClosed: false },
  GENERAL_API: { limit: 300, windowMs: 5 * 60_000, failClosed: false },
  PUBLIC_PRICING: { limit: 120, windowMs: 5 * 60_000, failClosed: false },
  PUBLIC_PRICING_LEAD: { limit: 10, windowMs: 60 * 60_000, failClosed: true },
  // Six batches a minute; a limiter failure refuses rather than admits.
  TELEMETRY: { limit: 6, windowMs: 60_000, failClosed: true },
};

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();

/** Keeps the map from growing without bound in a long-lived process. */
function sweep(now: number): void {
  if (counters.size < 10_000) return;
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(
  category: RateLimitCategory,
  subject: string,
): RateLimitResult {
  const rule = RULES[category];
  const now = Date.now();

  try {
    sweep(now);
    const key = `${category}:${subject}`;
    const existing = counters.get(key);

    if (!existing || existing.resetAt <= now) {
      counters.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    const allowed = existing.count <= rule.limit;

    if (!allowed) {
      // Subject is already a hash or an id, never a raw credential
      // (PRD #30 §138, §159).
      logger.warn("security.rate_limit.triggered", {
        category,
        retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
      });
    }

    return {
      allowed,
      remaining: Math.max(0, rule.limit - existing.count),
      retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
    };
  } catch {
    logger.error("security.rate_limit.failed", { category });
    // Security-critical categories refuse rather than open (PRD #30 §190).
    return rule.failClosed
      ? { allowed: false, remaining: 0, retryAfterSeconds: 60 }
      : { allowed: true, remaining: 0, retryAfterSeconds: 0 };
  }
}

/** Hashes an identifier so logs and counters never hold a raw email. */
export async function hashSubject(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Test seam: the in-memory window is per-process, so tests must reset it. */
export function resetRateLimits(): void {
  counters.clear();
}
