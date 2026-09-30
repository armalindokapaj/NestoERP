"use client";

/**
 * Device-side flows that cross the platform services and the NESTO API
 * (MOB-08 §24-§26, §34-§36, §82). Everything here is a no-op in a browser.
 */
import { getPlatformServices } from "./registry";

const PUSH_TOKEN_KEY = "push.token";
const APP_LOCK_KEY = "applock.enabled";

async function call(method: "POST" | "DELETE", body: unknown): Promise<boolean> {
  try {
    const response = await fetch("/api/me/devices", {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function registerToken(token: string, platform: "ios" | "android"): Promise<boolean> {
  const info = await getPlatformServices().platform.appVersion();
  if (!info) return false;
  const ok = await call("POST", { platform, pushToken: token, appVersion: info.version, appBuild: info.build });
  if (ok) await getPlatformServices().secureStorage.set(PUSH_TOKEN_KEY, token);
  return ok;
}

/** The "turn on notifications" action: the only place the OS permission prompt is raised. */
export async function enablePushNotifications(): Promise<"enabled" | "denied" | "failed" | "unsupported"> {
  const { notifications } = getPlatformServices();
  if (!notifications.available) return "unsupported";
  const registration = await notifications.register();
  if (!registration) return (await notifications.permission()) === "denied" ? "denied" : "failed";
  return (await registerToken(registration.token, registration.platform)) ? "enabled" : "failed";
}

export async function disablePushNotifications(): Promise<void> {
  const { notifications, secureStorage } = getPlatformServices();
  const token = await secureStorage.get(PUSH_TOKEN_KEY);
  if (token) await call("DELETE", { pushToken: token });
  await notifications.unregister();
  await secureStorage.remove(PUSH_TOKEN_KEY);
}

/**
 * At launch, for someone who already allowed notifications: refreshes the
 * registration (tokens rotate) without ever prompting. A signed-out launch gets
 * a 401 and simply does nothing.
 */
export async function refreshPushRegistration(): Promise<void> {
  const { notifications } = getPlatformServices();
  if (!notifications.available || (await notifications.permission()) !== "granted") return;
  const registration = await notifications.register();
  if (registration) await registerToken(registration.token, registration.platform);
}

export async function isAppLockEnabled(): Promise<boolean> {
  return (await getPlatformServices().secureStorage.get(APP_LOCK_KEY)) === "1";
}

export async function setAppLockEnabled(enabled: boolean): Promise<boolean> {
  const { biometrics, secureStorage } = getPlatformServices();
  if (enabled) {
    // Turning the lock on proves the person can pass it, or they could lock themselves out.
    if (!(await biometrics.isEnrolled()) || !(await biometrics.authenticate("Turn on app lock"))) return false;
    await secureStorage.set(APP_LOCK_KEY, "1");
    return true;
  }
  await secureStorage.remove(APP_LOCK_KEY);
  return true;
}

/**
 * Sign-out cleanup (§36). Local only: the server deletes the session, and the
 * device registration goes with it (cascade), so no authenticated call is made
 * here — by now the signed-out marker already stops them. Unregistering
 * invalidates the OS push token, so even an offline sign-out whose server call
 * fails cannot be pushed to. Bounded so nothing holds sign-out up.
 */
export async function nativeSignOutCleanup(): Promise<void> {
  const services = getPlatformServices();
  if (!services.platform.isNative) return;
  const work = (async () => {
    await services.notifications.unregister();
    await services.secureStorage.clear();
  })();
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 3000))]).catch(() => undefined);
}
