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
  // Reads/revokes the signed credential directly; workspace authorization must never block logout.
  "/api/auth/lifecycle": "AUTH_PROVIDER",
  // The anonymous 3D viewer (ADM-04A §7): read-only, keyed by an opaque share id,
  // answering only for a live PUBLIC experience with an approved projection.
  "/api/public/3d/[publicId]": "PUBLIC",
  "/api/public/3d/[publicId]/status": "PUBLIC",
  // Its model bytes: the credential is the server-signed, epoch-bound handle.
  "/api/public/3d/[publicId]/assets/[handle]": "SIGNED",
};
