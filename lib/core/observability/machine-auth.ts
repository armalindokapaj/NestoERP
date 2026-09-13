import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check for machine endpoints (PRD #38 §105).
 *
 * Constant-time, and closed by default: with no token configured the endpoint
 * does not exist, rather than existing for everybody.
 */
export function machineRequestAllowed(request: Request, configured: string | undefined): boolean {
  if (!configured || configured.length < 24) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}
