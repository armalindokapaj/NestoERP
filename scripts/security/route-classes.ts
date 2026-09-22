import { PUBLIC_OPERATIONAL_ROUTES, PUBLIC_PRICING_ROUTES, TOKEN_AUTHENTICATED_ROUTES } from "../../lib/permissions/route-access";

/**
 * API routes that are not session-authenticated, each with the credential that
 * replaces the session (PRD #47 §103, §104). Everything else is a session
 * route and must run inside `withContext`.
 */
export const ROUTE_CLASSES: Record<string, "PUBLIC" | "TOKEN" | "SIGNED" | "AUTH_PROVIDER"> = {
  ...Object.fromEntries(PUBLIC_OPERATIONAL_ROUTES.map((route) => [route, "PUBLIC" as const])),
  ...Object.fromEntries(PUBLIC_PRICING_ROUTES.map((route) => [route, "PUBLIC" as const])),
  ...Object.fromEntries(TOKEN_AUTHENTICATED_ROUTES.map((route) => [route, "TOKEN" as const])),
  "/api/storage/objects/[...key]": "SIGNED",
  "/api/auth/[...nextauth]": "AUTH_PROVIDER",
};
