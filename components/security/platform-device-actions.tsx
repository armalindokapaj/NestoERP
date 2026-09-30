"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useReauth } from "./use-reauth";

type Kind = "REVOKE" | "LOST" | "BLOCK" | "RESTORE";
const KEY = { REVOKE: "revoke", LOST: "lost", BLOCK: "block", RESTORE: "restore" } as const;

/** Platform Admin's device actions: always with a reason and a recent sign-in, audited globally (MOB-11 §26, §185). */
export function PlatformDeviceActions({ deviceId, userName, status }: { deviceId: string; userName: string; status: string }) {
  const t = useTranslations("security");
  const router = useRouter();
  const toast = useToast();
  const { ensure, dialog } = useReauth("/api/platform-admin/reauthenticate");
  const [confirming, setConfirming] = React.useState<Kind | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const inactive = status === "REVOKED" || status === "BLOCKED";

  function run(kind: Kind) {
    startTransition(async () => {
      if (!(await ensure())) return;
      const response = await fetch("/api/platform-admin/command", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "device.action", deviceId, kind, reason }) }).catch(() => null);
      if (!response?.ok) return void toast({ title: t("devices.errors.SAVE_FAILED"), tone: "danger" });
      toast({ title: t(`devices.done.${kind === "RESTORE" ? "restore" : kind === "LOST" ? "lost" : "revoke"}`), tone: "success" });
      setConfirming(null);
      setReason("");
      router.refresh();
    });
  }

  const kinds: Kind[] = inactive ? ["RESTORE"] : ["REVOKE", "LOST", "BLOCK"];
  return (
    <span className="inline-flex flex-wrap gap-1">
      {kinds.map((kind) => (
        <Button key={kind} size="sm" variant={kind === "RESTORE" ? "secondary" : "danger"} disabled={pending} onClick={() => setConfirming(kind)}>{t(`admin.devices.actions.${KEY[kind]}`)}</Button>
      ))}
      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirming(null)}
          title={t(`admin.devices.confirm.${KEY[confirming]}Title`, { name: userName })}
          description={t(`admin.devices.confirm.${KEY[confirming]}Body`)}
          confirmLabel={t(`admin.devices.actions.${KEY[confirming]}`)}
          destructive={confirming !== "RESTORE"}
          pending={pending || reason.trim().length < 3}
          onConfirm={() => run(confirming)}
        >
          <div className="space-y-1.5">
            <label htmlFor="platform-device-reason" className="text-meta text-fg-subtle">{t("admin.devices.reason")}</label>
            <Input id="platform-device-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          </div>
        </ConfirmDialog>
      ) : null}
      {dialog}
    </span>
  );
}
