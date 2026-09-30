"use client";

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { onBeforeLogout } from "@/lib/auth/client-lifecycle";
import { nativeSignOutCleanup, refreshPushRegistration } from "@/lib/device/device-client";
import { resolveDeepLink } from "@/lib/device/links";
import { publishActivityChange } from "@/lib/activity/client";
import { getPlatform, hasCapability } from "@/lib/device/platform";
import { getPlatformServices, installPlatformServices } from "@/lib/device/registry";
import type { AppCompatibility } from "@/lib/device/compatibility";
import {
  biometryChanged,
  isAppLockOn,
  lockSettings,
  publishInstallCookie,
  readCachedState,
  reportDevice,
} from "@/lib/device/security-client";
import { applyRevocations, handleRevokedSession, liftSecurityLock, type RemovalReport } from "@/lib/offline/revocation";
import { isSensitiveSurface } from "@/lib/device/sensitive-surfaces";
import { setSecurityState, useDeviceSecurity } from "@/lib/device/security-store";
import type { DeviceSecurityState } from "@/lib/device/security-types";

const STORE_URL: Record<"ios" | "android", string | undefined> = {
  ios: process.env.NEXT_PUBLIC_IOS_STORE_URL,
  android: process.env.NEXT_PUBLIC_ANDROID_STORE_URL,
};

/** The last time the app left the foreground, kept so a cold start can tell how long it was away (MOB-11 §45). */
const BACKGROUND_KEY = "applock.backgroundAt";
/** A report is not repeated sooner than this, whatever triggers it: no API call per route or per resume (MOB-11 §127, §176). */
const REPORT_MIN_INTERVAL_MS = 60_000;
/** While the app stays open, it asks again this often. */
const REPORT_INTERVAL_MS = 15 * 60_000;

type Blocker = "update" | "security-update" | "revoked" | "blocked" | null;

/**
 * Wires the native shell into the page (MOB-08 §16, §26, §30, §44-§47, §50-§53,
 * §61, §66-§68; MOB-11). Renders nothing in a browser and costs a platform check: the
 * plugin code is imported only inside the shell. Everything it does goes through
 * `lib/device` — there is no `if (ios)` in any module.
 */
export function NativeBootstrap() {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (getPlatform() === "web") return;
    let cancelled = false;
    void import("@/lib/device/native").then((native) => {
      if (cancelled) return;
      installPlatformServices(native.createNativeServices(window.location.origin));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready ? <NativeRuntime /> : null;
}

function NativeRuntime() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("native");
  const services = getPlatformServices();
  const security = useDeviceSecurity();
  const [compat, setCompat] = React.useState<AppCompatibility | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [locked, setLocked] = React.useState<false | "biometric" | "password-only">(false);
  const [covered, setCovered] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  const [restored, setRestored] = React.useState(false);
  const [blocker, setBlocker] = React.useState<Blocker>(null);
  const [warningDismissed, setWarningDismissed] = React.useState(false);
  const [removal, setRemoval] = React.useState<RemovalReport[] | null>(null);
  const [captureNotice, setCaptureNotice] = React.useState(false);
  const backgroundedAt = React.useRef<number | null>(null);
  const lastReport = React.useRef(0);
  const wasSignedOutPage = React.useRef(true);
  const settingsRef = React.useRef(lockSettings(false, null));

  const checkCompatibility = React.useCallback(async () => {
    try {
      const response = await fetch("/api/app/compatibility", { cache: "no-store" });
      if (response.ok) setCompat((await response.json()) as AppCompatibility);
    } catch {
      /* Unreachable server: the offline page handles it; never block on a failed check. */
    }
  }, []);

  /** What the app does with the standing the server just described (MOB-11 §62-§64, §137-§139). */
  const applyState = React.useCallback(async (state: DeviceSecurityState) => {
    setSecurityState(state);
    settingsRef.current = lockSettings(await isAppLockOn(), state.policy);
    if (state.device.status !== "ACTIVE") {
      // The server ended this session with the revocation; the app removes NESTO's local data and says so (§18, §20, §22).
      setBlocker(state.device.status === "REVOKED" ? "revoked" : "blocked");
      const reports = await handleRevokedSession(state.device.userId);
      if (reports.length) setRemoval(reports);
      return;
    }
    if (state.compliance.action === "BLOCK") setBlocker("blocked");
    else if (state.compliance.action === "REQUIRE_UPDATE") setBlocker(state.compliance.reasons.includes("APP_VERSION_UNSUPPORTED") ? "update" : "security-update");
    else setBlocker(null);
    // An active device the server confirmed, with nothing left to remove: an earlier removal's lock lifts (§60).
    if (!state.dataRemoval && state.compliance.action !== "BLOCK") void liftSecurityLock(state.device.userId);
  }, []);

  /** Asks the server, throttled. `force` is for events that change the answer — sign-in, coming back online. */
  const checkSecurity = React.useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastReport.current < REPORT_MIN_INTERVAL_MS) return;
      lastReport.current = now;
      const result = await reportDevice();
      if (result.kind === "state") await applyState(result.state);
      else if (result.kind === "update-required") setBlocker("update");
      else if (result.kind === "signed-out") {
        // No session: there may still be a revocation this device has not acted on (MOB-11 §126, §165).
        const reports = await applyRevocations();
        if (reports.length) setRemoval(reports);
      }
      // "unreachable": the cached state keeps applying; nothing is decided from a failed call.
    },
    [applyState],
  );

  const unlock = React.useCallback(async () => {
    const { biometricRequired } = settingsRef.current;
    if (await services.biometrics.authenticate(t("lockBody"), { allowDeviceCredential: !biometricRequired })) setLocked(false);
  }, [services, t]);

  /** Decides whether the lock applies now, and which way out it offers (MOB-11 §42, §43, §44). */
  const engageLock = React.useCallback(async () => {
    const settings = settingsRef.current;
    if (!settings.enabled) return;
    const unavailable = !(await services.biometrics.isEnrolled()) || (await biometryChanged());
    setLocked(unavailable ? "password-only" : "biometric");
    if (!unavailable) void unlock();
  }, [services, unlock]);

  React.useEffect(() => {
    void services.lifecycle.hideSplash();
    void checkCompatibility();
    void refreshPushRegistration();
    void services.privacy.setSwitcherCover(true);
    const offLogout = onBeforeLogout(nativeSignOutCleanup);

    // Cold start: the cached policy applies at once, before any network call (§128), and a lock that is on holds the app (§45).
    void (async () => {
      await publishInstallCookie();
      const cached = await readCachedState();
      if (cached) {
        setSecurityState(cached);
        settingsRef.current = lockSettings(await isAppLockOn(), cached.policy);
      } else {
        settingsRef.current = lockSettings(await isAppLockOn(), null);
      }
      if (settingsRef.current.enabled) {
        const at = Number(await services.secureStorage.get(BACKGROUND_KEY));
        const away = Number.isFinite(at) && at > 0 ? Date.now() - at : Number.POSITIVE_INFINITY;
        // A clock wound backwards reads as "away for ever": the lock engages rather than the timeout being stretched (§129).
        if (away < 0 || away >= settingsRef.current.timeoutMs) await engageLock();
      }
      await checkSecurity(true);
    })();

    const applyStatusBar = () => {
      const explicit = document.documentElement.getAttribute("data-theme");
      const dark = explicit ? explicit === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      void services.lifecycle.setStatusBar(dark ? "dark" : "light");
    };
    applyStatusBar();
    const observer = new MutationObserver(applyStatusBar);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyStatusBar);

    const interval = window.setInterval(() => void checkSecurity(), REPORT_INTERVAL_MS);

    const off = [
      // A link the OS opened: only a NESTO path is followed, and the route's own checks decide what shows (§30, §31).
      services.lifecycle.onOpenUrl((url) => {
        const path = resolveDeepLink(url, window.location.origin);
        if (path) router.push(path);
      }),
      services.notifications.onOpen((path) => router.push(path)),
      // A push while the app is open: no OS banner, the bell and inbox re-ask the server (MOB-10 §44, §132).
      services.notifications.onReceive(() => publishActivityChange()),
      services.lifecycle.onBackground(() => {
        backgroundedAt.current = Date.now();
        // Covered before the OS takes its app-switcher snapshot, whatever the platform adds on top (MOB-11 §46, §100).
        setCovered(true);
        void services.secureStorage.set(BACKGROUND_KEY, String(Date.now())).catch(() => undefined);
      }),
      services.lifecycle.onResume(() => {
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
        backgroundedAt.current = null;
        setCovered(false);
        void checkCompatibility();
        void checkSecurity();
        // Stale data after a long pause: re-ask the server, which also re-checks the session.
        router.refresh();
        if (away >= settingsRef.current.timeoutMs) void engageLock();
      }),
      services.lifecycle.onNetworkChange(({ online: now }) => {
        setOnline(now);
        if (now) {
          setRestored(true);
          setTimeout(() => setRestored(false), 3000);
          void checkSecurity(true);
        }
      }),
      services.privacy.onScreenshot(() => setCaptureNotice(true)),
    ];

    if (hasCapability("backButton")) {
      // Android Back follows the route history; the app only closes at the root (§50).
      off.push(
        services.lifecycle.onBack((canGoBack) => {
          if (canGoBack || window.history.length > 1) window.history.back();
          else void services.lifecycle.exitApp();
        }),
      );
    }

    return () => {
      offLogout();
      window.clearInterval(interval);
      observer.disconnect();
      media.removeEventListener("change", applyStatusBar);
      off.forEach((fn) => fn());
    };
  }, [services, router, checkCompatibility, checkSecurity, engageLock]);

  // Signing in is an event that changes the answer; moving between routes is not (§127, §176).
  React.useEffect(() => {
    const signedOutPage = pathname.startsWith("/login") || pathname.startsWith("/forgot-password") || pathname.startsWith("/reset-password") || pathname.startsWith("/invite");
    if (wasSignedOutPage.current && !signedOutPage) void checkSecurity(true);
    // Back on a sign-in page: the session ended, which is when a revocation that caused it needs acting on (§20).
    if (!wasSignedOutPage.current && signedOutPage) void applyRevocations().then((reports) => reports.length && setRemoval(reports));
    wasSignedOutPage.current = signedOutPage;
  }, [pathname, checkSecurity]);

  // A sensitive surface restricts capture for as long as it is on screen, where the OS lets an app (§88-§90).
  const sensitive = isSensitiveSurface(pathname, security?.policy ?? null);
  React.useEffect(() => {
    if (!sensitive) return;
    void services.privacy.setSensitiveSurface(true);
    return () => {
      void services.privacy.setSensitiveSurface(false);
      setCaptureNotice(false);
    };
  }, [sensitive, services]);

  const platform = services.platform.platform;
  const storeUrl = platform === "ios" || platform === "android" ? STORE_URL[platform] : undefined;
  const openStore = () => {
    if (storeUrl) void services.externalLinks.open(storeUrl);
  };
  const signIn = () => void import("@/lib/auth/client-lifecycle").then((m) => m.logout());
  const removalMessage = (reports: RemovalReport[]): string => {
    const unsynced = reports.reduce((sum, report) => sum + report.unsynced, 0);
    return unsynced > 0 ? t("removalNotice", { count: unsynced }) : t("removalNoticeNone");
  };
  const showRisk = security?.compliance.action === "WARN" && !warningDismissed && !blocker;

  return (
    <>
      {!online || restored ? (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-[var(--nesto-safe-top)] z-[90] flex justify-center px-4 pt-2">
          <span className="rounded-full bg-fg px-3 py-1 text-meta text-canvas shadow-md">{online ? t("restored") : t("offline")}</span>
        </div>
      ) : null}

      {sensitive && captureNotice ? (
        <div role="status" className="fixed inset-x-0 bottom-[var(--nesto-safe-bottom)] z-[90] m-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 shadow-lg" data-testid="sensitive-capture-notice">
          <span className="text-table">{t("sensitiveCapture")}</span>
          <Button variant="ghost" size="sm" onClick={() => setCaptureNotice(false)}>{t("dismiss")}</Button>
        </div>
      ) : null}

      {compat?.status === "update-recommended" && !dismissed && !blocker ? (
        <div role="status" className="fixed inset-x-0 bottom-[var(--nesto-safe-bottom)] z-[90] m-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 shadow-lg">
          <span className="text-table">{t("updateRecommended")}</span>
          <span className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>{t("updateLater")}</Button>
            <Button size="sm" onClick={openStore}>{t("updateAction")}</Button>
          </span>
        </div>
      ) : null}

      {showRisk ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="native-risk-title" className="fixed inset-x-0 bottom-[var(--nesto-safe-bottom)] z-[95] m-3 space-y-2 rounded-lg border border-line bg-surface p-4 shadow-lg" data-testid="device-risk-warning">
          <h2 id="native-risk-title" className="text-table font-semibold">{t("riskTitle")}</h2>
          <p className="text-table text-fg-muted">{t("riskBody")}</p>
          <div className="flex justify-end"><Button size="sm" onClick={() => setWarningDismissed(true)}>{t("riskContinue")}</Button></div>
        </div>
      ) : null}

      {compat?.status === "update-required" && !blocker ? (
        <Blocker title={t("updateRequiredTitle")} body={t("updateRequiredBody")}>
          <Button onClick={openStore}>{t("updateAction")}</Button>
        </Blocker>
      ) : null}

      {blocker === "update" ? (
        <Blocker title={t("updateRequiredTitle")} body={t("updateRequiredBody")}>
          <Button onClick={openStore}>{t("updateAction")}</Button>
        </Blocker>
      ) : null}

      {blocker === "security-update" ? (
        <Blocker title={t("securityUpdateTitle")} body={t("securityUpdateBody")}>
          <Button onClick={openStore}>{t("updateAction")}</Button>
        </Blocker>
      ) : null}

      {blocker === "revoked" || blocker === "blocked" ? (
        <Blocker title={t(blocker === "revoked" ? "revokedTitle" : "blockedTitle")} body={removal ? removalMessage(removal) : t(blocker === "revoked" ? "revokedBody" : "blockedBody")}>
          <Button variant="secondary" onClick={signIn}>{t("usePassword")}</Button>
        </Blocker>
      ) : null}

      {!blocker && removal ? (
        <Blocker title={t("revokedTitle")} body={removalMessage(removal)}>
          <Button onClick={() => setRemoval(null)}>{t("dismiss")}</Button>
        </Blocker>
      ) : null}

      {locked ? (
        <Blocker title={t("lockTitle")} body={locked === "password-only" ? t("lockBiometryChanged") : t("lockBody")}>
          {locked === "biometric" ? <Button onClick={() => void unlock()}>{t("unlock")}</Button> : null}
          {/* Never a dead end: a valid user can always fall back to the canonical sign-in (§26, MOB-11 §42). */}
          <Button variant="ghost" onClick={signIn}>{t("usePassword")}</Button>
        </Blocker>
      ) : null}

      {covered && !locked ? <PrivacyCover /> : null}
    </>
  );
}

/** A neutral NESTO screen in place of whatever was showing while the app is in the background (MOB-11 §46, §100). */
function PrivacyCover() {
  return (
    <div aria-hidden="true" data-testid="privacy-cover" className="fixed inset-0 z-[110] grid place-items-center bg-canvas">
      <span className="text-2xl font-semibold tracking-[0.2em] text-fg">NESTO</span>
    </div>
  );
}

function Blocker({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="native-blocker-title" className="fixed inset-0 z-[100] grid place-items-center bg-canvas p-6 pt-[calc(var(--nesto-safe-top)+1.5rem)] pb-[calc(var(--nesto-safe-bottom)+1.5rem)]">
      <div className="flex max-w-sm flex-col items-stretch gap-3 text-center">
        <h1 id="native-blocker-title" className="text-lg font-semibold">{title}</h1>
        <p className="text-table text-fg-muted">{body}</p>
        {children}
      </div>
    </div>
  );
}
