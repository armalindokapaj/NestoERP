"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { onBeforeLogout } from "@/lib/auth/client-lifecycle";
import { isAppLockEnabled, nativeSignOutCleanup, refreshPushRegistration } from "@/lib/device/device-client";
import { resolveDeepLink } from "@/lib/device/links";
import { getPlatform, hasCapability } from "@/lib/device/platform";
import { getPlatformServices, installPlatformServices } from "@/lib/device/registry";
import type { AppCompatibility } from "@/lib/device/compatibility";

/** Away longer than this and the app lock asks again (§25). */
const LOCK_AFTER_MS = 60_000;

const STORE_URL: Record<"ios" | "android", string | undefined> = {
  ios: process.env.NEXT_PUBLIC_IOS_STORE_URL,
  android: process.env.NEXT_PUBLIC_ANDROID_STORE_URL,
};

/**
 * Wires the native shell into the page (MOB-08 §16, §26, §30, §44-§47, §50-§53,
 * §61, §66-§68). Renders nothing in a browser and costs a platform check: the
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
  const t = useTranslations("native");
  const services = getPlatformServices();
  const [compat, setCompat] = React.useState<AppCompatibility | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [locked, setLocked] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  const [restored, setRestored] = React.useState(false);
  const backgroundedAt = React.useRef<number | null>(null);

  const checkCompatibility = React.useCallback(async () => {
    try {
      const response = await fetch("/api/app/compatibility", { cache: "no-store" });
      if (response.ok) setCompat((await response.json()) as AppCompatibility);
    } catch {
      /* Unreachable server: the offline page handles it; never block on a failed check. */
    }
  }, []);

  const unlock = React.useCallback(async () => {
    if (await services.biometrics.authenticate(t("lockBody"))) setLocked(false);
  }, [services, t]);

  React.useEffect(() => {
    void services.lifecycle.hideSplash();
    void checkCompatibility();
    void refreshPushRegistration();
    const offLogout = onBeforeLogout(nativeSignOutCleanup);

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

    const off = [
      // A link the OS opened: only a NESTO path is followed, and the route's own checks decide what shows (§30, §31).
      services.lifecycle.onOpenUrl((url) => {
        const path = resolveDeepLink(url, window.location.origin);
        if (path) router.push(path);
      }),
      services.notifications.onOpen((path) => router.push(path)),
      services.lifecycle.onBackground(() => {
        backgroundedAt.current = Date.now();
      }),
      services.lifecycle.onResume(() => {
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
        backgroundedAt.current = null;
        void checkCompatibility();
        // Stale data after a long pause: re-ask the server, which also re-checks the session.
        router.refresh();
        if (away > LOCK_AFTER_MS) {
          void isAppLockEnabled().then((enabled) => {
            if (!enabled) return;
            setLocked(true);
            void unlock();
          });
        }
      }),
      services.lifecycle.onNetworkChange(({ online: now }) => {
        setOnline(now);
        if (now) {
          setRestored(true);
          setTimeout(() => setRestored(false), 3000);
        }
      }),
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
      observer.disconnect();
      media.removeEventListener("change", applyStatusBar);
      off.forEach((fn) => fn());
    };
  }, [services, router, checkCompatibility, unlock]);

  const platform = services.platform.platform;
  const storeUrl = platform === "ios" || platform === "android" ? STORE_URL[platform] : undefined;
  const openStore = () => {
    if (storeUrl) void services.externalLinks.open(storeUrl);
  };

  return (
    <>
      {!online || restored ? (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-[var(--nesto-safe-top)] z-[90] flex justify-center px-4 pt-2">
          <span className="rounded-full bg-fg px-3 py-1 text-meta text-canvas shadow-md">{online ? t("restored") : t("offline")}</span>
        </div>
      ) : null}

      {compat?.status === "update-recommended" && !dismissed ? (
        <div role="status" className="fixed inset-x-0 bottom-[var(--nesto-safe-bottom)] z-[90] m-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 shadow-lg">
          <span className="text-table">{t("updateRecommended")}</span>
          <span className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>{t("updateLater")}</Button>
            <Button size="sm" onClick={openStore}>{t("updateAction")}</Button>
          </span>
        </div>
      ) : null}

      {compat?.status === "update-required" ? (
        <Blocker title={t("updateRequiredTitle")} body={t("updateRequiredBody")}>
          <Button onClick={openStore}>{t("updateAction")}</Button>
        </Blocker>
      ) : null}

      {locked ? (
        <Blocker title={t("lockTitle")} body={t("lockBody")}>
          <Button onClick={() => void unlock()}>{t("unlock")}</Button>
          {/* Never a dead end: a valid user can always fall back to the canonical sign-in (§26). */}
          <Button variant="ghost" onClick={() => void import("@/lib/auth/client-lifecycle").then((m) => m.logout())}>{t("usePassword")}</Button>
        </Blocker>
      ) : null}
    </>
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
