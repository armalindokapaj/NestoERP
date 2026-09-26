import { checkSeedTarget, parseTarget } from "../../lib/core/database/target";

/**
 * Demo records must never reach production (PRD #9 §6, §248; AUD-12 §5).
 * Checked before the seed writes anything:
 * - never where APP_ENV (or Vercel) says production or staging, whatever
 *   ALLOW_DEMO_SEED says;
 * - a production Node build also needs the explicit ALLOW_DEMO_SEED opt-in and
 *   its own demo password;
 * - a database that is not on this machine is seeded only when
 *   NESTO_SEED_TARGET names it exactly.
 */
export function assertSeedAllowed(env: Record<string, string | undefined> = process.env): void {
  if (!env.DATABASE_URL) throw new Error("Refusing to seed: DATABASE_URL is not set.");
  const verdict = checkSeedTarget(parseTarget(env.DATABASE_URL), env);
  if (!verdict.ok) throw new Error(`Refusing to seed demo data: ${verdict.reason}`);
  if (env.NODE_ENV === "production" && env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data: NODE_ENV is production and ALLOW_DEMO_SEED is not set.");
  }
  if (!env.NESTO_DEMO_PASSWORD && env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NESTO_DEMO_PASSWORD must be set outside development.");
  }
}
