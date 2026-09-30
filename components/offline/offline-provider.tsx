"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { setLogoutGuard } from "@/lib/auth/client-lifecycle";
import { unsyncedCount } from "@/lib/offline/queue";
import { offlineRuntime } from "@/lib/offline/runtime";
import { otherAccountsWithPending } from "@/lib/offline/security";
import { registerOfflineShell, reportLoadedAssets } from "@/lib/offline/service-worker";

/**
 * Starts the offline layer for the signed-in person and guards sign-out
 * (MOB-09 §97, §98). Mounted once per authenticated surface: the application
 * shell, and the offline workspace itself.
 *
 * `userId` is null only on the offline workspace after a cold start with no
 * network, where the last person to use this device is the one whose database
 * is opened — and whose authorisation window still applies.
 */
export function OfflineProvider({ userId }: { userId: string | null }) {
  React.useEffect(() => {
    const runtime = offlineRuntime();
    void runtime.start(userId);
    void registerOfflineShell().then((registered) => {
      if (registered) setTimeout(reportLoadedAssets, 4_000);
    });
  }, [userId]);

  return <LogoutPrompt />;
}

type Prompt = { count: number; resolve: (proceed: boolean) => void } | null;

function LogoutPrompt() {
  const t = useTranslations("offline");
  const [prompt, setPrompt] = React.useState<Prompt>(null);

  React.useEffect(() => {
    return setLogoutGuard(async () => {
      const runtime = offlineRuntime();
      const db = runtime.database;
      // This person's unsynced work, and any left by another account on this device.
      const own = db ? await unsyncedCount(db).catch(() => 0) : 0;
      const other = db ? otherAccountsWithPending(db.userId) : 0;
      const count = own + other;
      if (count === 0) return true;
      return new Promise<boolean>((resolve) => setPrompt({ count, resolve }));
    });
  }, []);

  const settle = (proceed: boolean, review = false) => {
    prompt?.resolve(proceed);
    setPrompt(null);
    if (review) window.location.assign("/offline?view=sync");
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="max-w-md" presentation="sheet-phone" data-testid="logout-pending-prompt">
        <DialogTitle>{prompt?.count === 1 ? t("logout.titleOne") : t("logout.title", { count: prompt?.count ?? 0 })}</DialogTitle>
        <DialogDescription>{t("logout.body")}</DialogDescription>
        <DialogFooter>
          <Button variant="secondary" onClick={() => settle(false)}>
            {t("logout.cancel")}
          </Button>
          <Button onClick={() => settle(false, true)} data-testid="logout-review-pending">
            {t("logout.review")}
          </Button>
        </DialogFooter>
        <div className="text-center">
          <Button variant="link" size="sm" onClick={() => settle(true)} data-testid="logout-anyway">
            {t("logout.anyway")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
