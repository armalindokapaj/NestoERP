"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { disablePushNotifications, enablePushNotifications, isAppLockEnabled, setAppLockEnabled } from "@/lib/device/device-client";
import { getPlatform } from "@/lib/device/platform";
import { getPlatformServices } from "@/lib/device/registry";

/**
 * Per-device switches, shown only inside the native app (MOB-08 §25, §32, §82).
 * Push is asked for here — never at launch — and the app lock is proven before
 * it is stored, so nobody can switch on a lock they cannot pass.
 */
export function NativeDeviceCard() {
  const t = useTranslations("native");
  const toast = useToast();
  const [native, setNative] = React.useState(false);
  const [push, setPush] = React.useState(false);
  const [lock, setLock] = React.useState(false);
  const [busy, setBusy] = React.useState<"push" | "lock" | null>(null);

  React.useEffect(() => {
    if (getPlatform() === "web") return;
    setNative(true);
    void (async () => {
      const services = getPlatformServices();
      setPush((await services.notifications.permission()) === "granted");
      setLock(await isAppLockEnabled());
    })();
  }, []);

  if (!native) return null;

  async function togglePush(next: boolean) {
    setBusy("push");
    try {
      if (!next) {
        await disablePushNotifications();
        setPush(false);
        return;
      }
      const result = await enablePushNotifications();
      setPush(result === "enabled");
      if (result === "denied") toast({ title: t("pushDenied"), tone: "danger" });
      else if (result !== "enabled") toast({ title: t("pushFailed"), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleLock(next: boolean) {
    setBusy("lock");
    try {
      const ok = await setAppLockEnabled(next);
      if (ok) setLock(next);
      else toast({ title: t("lockUnavailable"), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="native-device-title" className="nesto-card p-6">
      <h2 id="native-device-title" className="text-table font-semibold">{t("deviceTitle")}</h2>
      <ul className="mt-3 divide-y divide-line">
        <Row label={t("pushLabel")} hint={t("pushHint")} checked={push} disabled={busy !== null} onChange={togglePush} />
        <Row label={t("lockLabel")} hint={t("lockHint")} checked={lock} disabled={busy !== null} onChange={toggleLock} />
      </ul>
    </section>
  );
}

function Row({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  const id = React.useId();
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-table font-medium">{label}</label>
        <p className="text-meta text-fg-muted">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </li>
  );
}
