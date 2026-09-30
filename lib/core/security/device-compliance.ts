import type { DeviceComplianceAction, DeviceComplianceState, DeviceStatus, DeviceTrustState } from "@prisma/client";

import { compareVersions } from "./app-version";
import type { EffectiveMobilePolicy } from "./mobile-policy.schema";

/**
 * The device compliance engine (MOB-11 §62-§72).
 *
 * A pure function of what the server knows and the effective policy: no I/O, so
 * every rule is unit-tested and the answer is the same wherever it is computed
 * (registration, heartbeat, policy change). It never claims a device is
 * "secure": the strongest state is COMPLIANT, meaning "nothing the server can
 * check is wrong", and client-reported risk is a hint the policy decides about
 * (§65).
 */

export type ComplianceReason =
  | "DEVICE_REVOKED"
  | "DEVICE_BLOCKED"
  | "BLOCKED_BUILD"
  | "APP_VERSION_UNSUPPORTED"
  | "SECURITY_UPDATE_REQUIRED"
  | "OS_VERSION_UNSUPPORTED"
  | "DEVICE_RISK"
  | "UPDATE_RECOMMENDED";

export type ComplianceInput = {
  platform: "IOS" | "ANDROID";
  status: DeviceStatus;
  appVersion: string;
  appBuild: string | null;
  osVersion: string | null;
  reportedRisk: readonly string[];
};

export type ComplianceResult = {
  state: DeviceComplianceState;
  action: DeviceComplianceAction;
  reasons: ComplianceReason[];
  trustState: DeviceTrustState;
};

const ACTION_RANK: Record<DeviceComplianceAction, number> = { ALLOW: 0, WARN: 1, REQUIRE_REAUTH: 2, REQUIRE_UPDATE: 3, BLOCK: 4 };
const RISK_SIGNALS = new Set(["ROOTED", "JAILBROKEN"]);

const pad = (value: string) => {
  const parts = value.split(".");
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).join(".");
};

/** True when `version` (and optionally `build`) is on the blocked list. */
export function isBlockedBuild(version: string, build: string | null, blocked: readonly string[]): boolean {
  return blocked.some((entry) => {
    const [v, b] = entry.split("+");
    return v === version && (b === undefined || b === build);
  });
}

export function evaluateDeviceCompliance(device: ComplianceInput, policy: EffectiveMobilePolicy): ComplianceResult {
  const reasons: ComplianceReason[] = [];
  let action = "ALLOW" as DeviceComplianceAction;
  const raise = (next: DeviceComplianceAction, reason: ComplianceReason) => {
    reasons.push(reason);
    if (ACTION_RANK[next] > ACTION_RANK[action]) action = next;
  };

  if (device.status === "REVOKED") raise("BLOCK", "DEVICE_REVOKED");
  if (device.status === "BLOCKED") raise("BLOCK", "DEVICE_BLOCKED");

  if (isBlockedBuild(device.appVersion, device.appBuild, policy.blockedBuilds)) raise("REQUIRE_UPDATE", "BLOCKED_BUILD");
  if (compareVersions(device.appVersion, policy.minimumAppVersion) < 0) raise("REQUIRE_UPDATE", "APP_VERSION_UNSUPPORTED");
  else if (compareVersions(device.appVersion, policy.minimumSecureVersion) < 0) raise("REQUIRE_UPDATE", "SECURITY_UPDATE_REQUIRED");
  else if (compareVersions(device.appVersion, policy.recommendedAppVersion) < 0) reasons.push("UPDATE_RECOMMENDED");

  const osFloor = device.platform === "IOS" ? policy.minimumOsVersion.ios : policy.minimumOsVersion.android;
  // An unknown OS version cannot be judged against a floor; the floor is only enforced on what the device told us.
  if (osFloor && device.osVersion && compareVersions(pad(device.osVersion), pad(osFloor)) < 0) raise("BLOCK", "OS_VERSION_UNSUPPORTED");

  const risky = device.reportedRisk.some((signal) => RISK_SIGNALS.has(signal));
  if (risky && policy.deviceRiskPolicy === "WARN") raise("WARN", "DEVICE_RISK");
  if (risky && policy.deviceRiskPolicy === "BLOCK") raise("BLOCK", "DEVICE_RISK");

  const state: DeviceComplianceState = action === "BLOCK" ? "BLOCKED" : action === "REQUIRE_UPDATE" ? "NON_COMPLIANT" : action === "WARN" ? "WARNING" : "COMPLIANT";
  const trustState: DeviceTrustState = state === "BLOCKED" || state === "NON_COMPLIANT" ? "NON_COMPLIANT" : risky ? "AT_RISK" : "UNKNOWN";
  return { state, action, reasons, trustState };
}
