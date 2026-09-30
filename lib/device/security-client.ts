"use client";

/**
 * The app's side of mobile security (MOB-11 §11, §20, §37-§45, §127-§129).
 * Everything here is a no-op in a browser. The server decides; this only
 * reports, caches what it was told and carries out NESTO Data Removal.
 */
import type { EffectiveMobilePolicy } from "@/lib/core/security/mobile-policy.schema";
import { INSTALL_COOKIE, isInstallId } from "@/lib/core/security/install-id";
import { getPlatformServices } from "./registry";
import type { DeviceSecurityState } from "./security-types";

const INSTALL_KEY = "install.id";
const STATE_KEY = "security.state";
const BIOMETRY_KEY = "applock.biometry";

/* -------------------------------------------------------------------------- */
/* This install                                                                */
/* -------------------------------------------------------------------------- */

function randomInstallId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The random id this install made for itself (MOB-11 §6, §84). Kept in secure
 * storage and kept across sign-out, so a returning install is recognised; not a
 * hardware identifier and not a secret.
 */
export async function installId(): Promise<string | null> {
  const { secureStorage } = getPlatformServices();
  if (!secureStorage.available) return null;
  const stored = await secureStorage.get(INSTALL_KEY);
  if (isInstallId(stored)) return stored;
  const fresh = randomInstallId();
  await secureStorage.set(INSTALL_KEY, fresh);
  return fresh;
}

/**
 * Names this install to the server before sign-in, so the session it creates is
 * tied to the device row (§11). Only ever used to restrict; omitting it makes a
 * session look like a browser's, never more trusted.
 */
export async function publishInstallCookie(): Promise<string | null> {
  const id = await installId();
  if (id) document.cookie = `${INSTALL_COOKIE}=${id}; path=/; max-age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return id;
}

/* -------------------------------------------------------------------------- */
/* Reporting and the cached answer                                             */
/* -------------------------------------------------------------------------- */

export type SecurityResult =
  | { kind: "state"; state: DeviceSecurityState }
  | { kind: "update-required" }
  | { kind: "signed-out" }
  /** Offline or the server could not be reached: the cached state, if any, still applies until it expires. */
  | { kind: "unreachable" };

export async function readCachedState(): Promise<DeviceSecurityState | null> {
  try {
    const raw = await getPlatformServices().secureStorage.get(STATE_KEY);
    return raw ? (JSON.parse(raw) as DeviceSecurityState) : null;
  } catch {
    return null;
  }
}

async function cacheState(state: DeviceSecurityState): Promise<void> {
  await getPlatformServices().secureStorage.set(STATE_KEY, JSON.stringify(state)).catch(() => undefined);
}

/**
 * The registration and refresh call (§11, §127). It sends what the app knows
 * about itself; the answer — policy, compliance, any removal instruction — is
 * the server's and is cached for when there is no connection (§128).
 */
export async function reportDevice(): Promise<SecurityResult> {
  const services = getPlatformServices();
  if (!services.platform.isNative) return { kind: "signed-out" };
  const [id, version, facts, lockEnabled] = await Promise.all([installId(), services.platform.appVersion(), services.platform.deviceFacts(), isAppLockOn()]);
  if (!id || !version) return { kind: "signed-out" };
  try {
    const response = await fetch("/api/me/security/device", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        installId: id,
        platform: services.platform.platform,
        appVersion: version.version,
        appBuild: version.build,
        ...(facts?.name ? { deviceName: facts.name } : {}),
        ...(facts?.deviceClass ? { deviceClass: facts.deviceClass } : {}),
        ...(facts?.osVersion ? { osVersion: facts.osVersion } : {}),
        // An emulator is reported as what it is; nothing here claims to detect root or jailbreak, which no JS check can do honestly.
        reportedRisk: facts?.isVirtual ? ["EMULATOR"] : [],
        appLockEnabled: lockEnabled,
        policyVersion: (await readCachedState())?.policy.policyVersion,
      }),
    });
    // 401/403 here are the session's (expired, membership gone): the session lifecycle handles them. A revoked
    // install is answered with a 200 that says so, because this endpoint ignores the device gate on purpose.
    if (response.status === 401 || response.status === 403) return { kind: "signed-out" };
    if (response.status === 426) return { kind: "update-required" };
    if (!response.ok) return { kind: "unreachable" };
    const state = ((await response.json()) as { data: DeviceSecurityState }).data;
    await cacheState(state);
    return { kind: "state", state };
  } catch {
    return { kind: "unreachable" };
  }
}

/* -------------------------------------------------------------------------- */
/* App lock                                                                    */
/* -------------------------------------------------------------------------- */

const APP_LOCK_KEY = "applock.enabled";

export async function isAppLockOn(): Promise<boolean> {
  return (await getPlatformServices().secureStorage.get(APP_LOCK_KEY)) === "1";
}

export type LockSettings = { enabled: boolean; timeoutMs: number; biometricRequired: boolean; required: boolean };

/** The person's own switch combined with the policy (§44, §45, §73, §74): the policy can require, never forbid. */
export function lockSettings(userEnabled: boolean, policy: EffectiveMobilePolicy | null): LockSettings {
  const required = Boolean(policy?.appLockRequired);
  return { enabled: userEnabled || required, required, timeoutMs: (policy?.appLockTimeoutSeconds ?? 60) * 1000, biometricRequired: Boolean(policy?.biometricRequired) };
}

/**
 * A lock that was enabled with one kind of biometry and finds another — or none
 * — has lost the thing it was proven with (§43). The app then asks for the NESTO
 * password rather than silently passing.
 */
export async function biometryChanged(): Promise<boolean> {
  const { biometrics, secureStorage } = getPlatformServices();
  const [now, then] = await Promise.all([biometrics.biometryKind(), secureStorage.get(BIOMETRY_KEY)]);
  return then !== null && now !== then;
}

export async function rememberBiometry(): Promise<void> {
  const { biometrics, secureStorage } = getPlatformServices();
  const kind = await biometrics.biometryKind();
  if (kind) await secureStorage.set(BIOMETRY_KEY, kind);
}

/** Tells the server the person turned app lock on or off (§111). Informational; never what the server relies on. */
export async function recordLockChoice(enabled: boolean): Promise<void> {
  try {
    await fetch("/api/me/security/events", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: enabled ? "BIOMETRIC_ENABLED" : "BIOMETRIC_DISABLED" }) });
  } catch {
    // Audit of a convenience setting never blocks it.
  }
}
