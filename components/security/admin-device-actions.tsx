"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useReauth } from "./use-reauth";

type Action = "SIGN_OUT" | "REAUTH" | "REVOKE" | "LOST" | "BLOCK" | "RESTORE";
const KEY = { SIGN_OUT: "signOut", REAUTH: "reauth", REVOKE: "revoke", LOST: "lost", BLOCK: "block", RESTORE: "restore" } as const;
const ERRORS = { SAVE_FAILED: 1, NOT_FOUND: 1, FORBIDDEN: 1, REAUTH_REQUIRED: 1 } as const;

/**
 * The security actions on one device, for an administrator (MOB-11 §29, §30).
 * Only the buttons the person holds the permission for are rendered; the server
 * decides again, and out-of-scope ids answer not-found.
 */
export function AdminDeviceActions({ deviceId, userName, status, canSessions, canDevices }: { deviceId: string; userName: string; status: "ACTIVE" | "STALE" | "REVOKED" | "BLOCKED"; canSessions: boolean; canDevices: boolean }) {
  const t = useTranslations("security");
  const router = useRouter();
  const toast = useToast();
  const { ensure, dialog } = useReauth();
  const [confirming, setConfirming] = React.useState<Action | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const inactive = status === "REVOKED" || status === "BLOCKED";

  function run(action: Action) {
    startTransition(async () => {
      if (!(await ensure())) return;
      try {
        const response = await fetch(`/api/security/devices/${deviceId}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
        if (!response.ok) {
          const code = ((await response.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code ?? "SAVE_FAILED";
          toast({ title: t(`devices.errors.${code in ERRORS ? (code as keyof typeof ERRORS) : "SAVE_FAILED"}`), tone: "danger" });
          return;
        }
        toast({ title: t(`devices.done.${action === "SIGN_OUT" || action === "REAUTH" ? "signOut" : action === "RESTORE" ? "restore" : action === "LOST" ? "lost" : "revoke"}`), tone: "success" });
        setConfirming(null);
        setReason("");
        router.refresh();
      } catch {
        toast({ title: t("devices.errors.SAVE_FAILED"), tone: "danger" });
      }
    });
  }

  const buttons: Array<{ action: Action; show: boolean; danger: boolean }> = [
    { action: "SIGN_OUT", show: canSessions && !inactive, danger: false },
    { action: "REAUTH", show: canSessions && !inactive, danger: false },
    { action: "REVOKE", show: canDevices && !inactive, danger: true },
    { action: "LOST", show: canDevices && !inactive, danger: true },
    { action: "BLOCK", show: canDevices && !inactive, danger: true },
    { action: "RESTORE", show: canDevices && inactive, danger: false },
  ];
  const visible = buttons.filter((button) => button.show);
  if (visible.length === 0) return <p className="text-meta text-fg-subtle">{t("admin.devices.forbidden")}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" data-testid="admin-device-actions">
        {visible.map(({ action, danger }) => (
          <Button key={action} variant={danger ? "danger" : "secondary"} size="sm" disabled={pending} onClick={() => setConfirming(action)}>
            {t(`admin.devices.actions.${KEY[action]}`)}
          </Button>
        ))}
      </div>
      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirming(null)}
          title={t(`admin.devices.confirm.${KEY[confirming]}Title`, { name: userName })}
          description={t(`admin.devices.confirm.${KEY[confirming]}Body`)}
          confirmLabel={t(`admin.devices.actions.${KEY[confirming]}`)}
          destructive={confirming !== "SIGN_OUT" && confirming !== "REAUTH" && confirming !== "RESTORE"}
          pending={pending}
          onConfirm={() => run(confirming)}
        >
          {confirming === "REVOKE" || confirming === "LOST" || confirming === "BLOCK" ? (
            <div className="space-y-1.5">
              <label htmlFor="device-action-reason" className="text-meta text-fg-subtle">{t("admin.devices.reason")}</label>
              <Textarea id="device-action-reason" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
      {dialog}
    </div>
  );
}
