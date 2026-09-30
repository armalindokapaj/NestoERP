"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth/client-lifecycle";
import { getPlatformServices } from "@/lib/device/registry";

const STORE_URL: Record<string, string | undefined> = {
  ios: process.env.NEXT_PUBLIC_IOS_STORE_URL,
  android: process.env.NEXT_PUBLIC_ANDROID_STORE_URL,
};

/** The way out of a revoked, blocked or out-of-date device: update where that helps, and sign out, never a dead end (MOB-11 §42). */
export function DeviceUnavailableActions({ update }: { update: boolean }) {
  const t = useTranslations("native");
  const services = getPlatformServices();
  const storeUrl = STORE_URL[services.platform.platform];
  return (
    <>
      {update && storeUrl ? <Button onClick={() => void services.externalLinks.open(storeUrl)}>{t("updateAction")}</Button> : null}
      <Button variant={update && storeUrl ? "ghost" : "secondary"} onClick={() => void logout()}>{t("usePassword")}</Button>
    </>
  );
}
