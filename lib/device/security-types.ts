import type { EffectiveMobilePolicy } from "@/lib/core/security/mobile-policy.schema";

/**
 * What the server tells an installed app about its standing (MOB-11 §11, §180).
 * Client-safe: types only, so the native layer and the server share one shape
 * without the client importing server code.
 */
export type DeviceComplianceAction = "ALLOW" | "WARN" | "REQUIRE_REAUTH" | "REQUIRE_UPDATE" | "BLOCK";

export type DeviceSecurityState = {
  device: { id: string; userId: string; status: "ACTIVE" | "REVOKED" | "BLOCKED"; name: string | null };
  compliance: { state: "COMPLIANT" | "WARNING" | "NON_COMPLIANT" | "BLOCKED" | "UNKNOWN"; action: DeviceComplianceAction; reasons: string[] };
  policy: EffectiveMobilePolicy;
  /** The server's clock: security expiry and policy validity are judged by it, never the device's (MOB-11 §129). */
  serverTime: string;
  dataRemoval: { mode: "CACHE_ONLY" | "FULL"; requestedAt: string } | null;
};
