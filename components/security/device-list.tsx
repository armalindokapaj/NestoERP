"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Smartphone, Tablet } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { logout } from "@/lib/auth/client-lifecycle";
import { useReauth } from "./use-reauth";

export type OwnDeviceRow = {
  id: string;
  name: string;
  platform: "IOS" | "ANDROID";
  deviceClass: string | null;
  osVersion: string | null;
  appVersion: string;
  appBuild: string | null;
  status: "ACTIVE" | "STALE" | "REVOKED" | "BLOCKED";
  complianceState: string;
  complianceReasons: string[];
  appLockEnabled: boolean | null;
  pushEnabled: boolean;
  activeSessions: number;
  current: boolean;
  /** Formatted on the server, so the browser's timezone cannot cause a hydration mismatch. */
  lastActiveLabel: string | null;
  firstSeenLabel: string;
  dataRemoval: { mode: string; confirmed: boolean } | null;
  /** The person revoked it themselves and may lift that. */
  canRestore: boolean;
};

type Action = "SIGN_OUT" | "REVOKE" | "LOST" | "RESTORE";

const TONE = { ACTIVE: "success", STALE: "default", REVOKED: "danger", BLOCKED: "danger" } as const;
const COMPLIANCE_TONE = { COMPLIANT: "success", WARNING: "warning", NON_COMPLIANT: "warning", BLOCKED: "danger", UNKNOWN: "default" } as const;

/** My Devices (MOB-11 §15-§17, §157). The person's own installed apps, and ending access for each. */
export function DeviceList({ devices }: { devices: OwnDeviceRow[] }) {
  const t = useTranslations("security");
  const router = useRouter();
  const toast = useToast();
  const { ensure, dialog } = useReauth();
  const [open, setOpen] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<{ device: OwnDeviceRow; action: Action } | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (devices.length === 0) return <p className="text-meta text-fg-subtle" data-testid="devices-none">{t("devices.none")}</p>;

  function run(device: OwnDeviceRow, action: Action) {
    startTransition(async () => {
      // A sensitive action: a recent sign-in first (§47). The server checks again regardless.
      if (!(await ensure())) return;
      try {
        const response = await fetch(`/api/me/devices/${device.id}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
        if (!response.ok) {
          const code = ((await response.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code ?? "SAVE_FAILED";
          toast({ title: t(`devices.errors.${code in ERRORS ? (code as keyof typeof ERRORS) : "SAVE_FAILED"}`), tone: "danger" });
          return;
        }
        toast({ title: t(`devices.done.${action === "SIGN_OUT" ? "signOut" : action === "REVOKE" ? "revoke" : action === "LOST" ? "lost" : "restore"}`), tone: "success" });
        setConfirming(null);
        // Ending this device's own access ends this page too.
        if (device.current && action !== "RESTORE") await logout();
        else router.refresh();
      } catch {
        toast({ title: t("devices.errors.SAVE_FAILED"), tone: "danger" });
      }
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-lg border border-line" aria-label={t("devices.title")} data-testid="device-list">
        {devices.map((device) => {
          const Icon = device.deviceClass === "TABLET" ? Tablet : Smartphone;
          const expanded = open === device.id;
          const inactive = device.status === "REVOKED" || device.status === "BLOCKED";
          return (
            <li key={device.id} className="px-4 py-3" data-testid="device-row" data-status={device.status}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-table font-medium text-fg">{device.name}</span>
                      {device.current ? <Badge tone="info">{t("devices.thisDevice")}</Badge> : null}
                      <Badge tone={TONE[device.status]}>{t(`devices.status.${device.status}`)}</Badge>
                    </div>
                    <p className="mt-0.5 text-meta text-fg-subtle">
                      {device.platform === "IOS" ? "iOS" : "Android"}{device.osVersion ? ` ${device.osVersion}` : ""} · NESTO {device.appVersion}
                      {" · "}
                      {device.current ? t("devices.activeNow") : device.lastActiveLabel ? t("devices.lastActive", { date: device.lastActiveLabel }) : ""}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : device.id)}>
                  {expanded ? t("devices.actions.close") : t("devices.actions.manage")}
                </Button>
              </div>

              {expanded ? (
                <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="device-detail">
                  <dl className="grid gap-x-6 gap-y-2 text-meta sm:grid-cols-2">
                    <Fact label={t("devices.platform")}>{device.platform === "IOS" ? "iOS" : "Android"}</Fact>
                    <Fact label={t("devices.app")}>{device.appVersion}{device.appBuild ? ` (${device.appBuild})` : ""}</Fact>
                    <Fact label={t("devices.firstSignIn")}>{device.firstSeenLabel}</Fact>
                    <Fact label={t("devices.security")}>
                      <Badge tone={COMPLIANCE_TONE[device.complianceState as keyof typeof COMPLIANCE_TONE] ?? "default"}>{t(`devices.compliance.${device.complianceState as "COMPLIANT"}`)}</Badge>
                    </Fact>
                    {device.appLockEnabled !== null ? <Fact label=" ">{t(`devices.appLock.${device.appLockEnabled ? "ON" : "OFF"}`)}</Fact> : null}
                    <Fact label=" ">{t(`devices.push.${device.pushEnabled ? "ON" : "OFF"}`)}</Fact>
                  </dl>
                  {device.complianceReasons.length ? (
                    <ul className="list-disc pl-5 text-meta text-fg-muted">
                      {device.complianceReasons.map((reason) => <li key={reason}>{t(`devices.reasons.${reason as "DEVICE_RISK"}`)}</li>)}
                    </ul>
                  ) : null}
                  {device.dataRemoval ? (
                    <p className="text-meta text-fg-muted" data-testid="device-removal">
                      {device.dataRemoval.confirmed ? t("devices.removalDone") : t(device.dataRemoval.mode === "FULL" ? "devices.removalFullPending" : "devices.removalPending")}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {inactive ? (
                      device.canRestore ? <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming({ device, action: "RESTORE" })}>{t("devices.actions.restore")}</Button> : null
                    ) : (
                      <>
                        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming({ device, action: "SIGN_OUT" })}>{t(device.current ? "devices.actions.signOut" : "devices.actions.signOutOther")}</Button>
                        <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirming({ device, action: "REVOKE" })}>{t("devices.actions.revoke")}</Button>
                        <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirming({ device, action: "LOST" })}>{t("devices.actions.lost")}</Button>
                      </>
                    )}
                  </div>
                  <p className="text-micro text-fg-subtle">{t("devices.note")}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirming(null)}
          title={t(`devices.confirm.${CONFIRM_KEY[confirming.action]}Title`, { name: confirming.device.name })}
          description={t(`devices.confirm.${CONFIRM_KEY[confirming.action]}Body`)}
          confirmLabel={t(`devices.actions.${ACTION_KEY[confirming.action]}`)}
          cancelLabel={t("devices.confirm.cancel")}
          destructive={confirming.action !== "RESTORE" && confirming.action !== "SIGN_OUT"}
          pending={pending}
          onConfirm={() => run(confirming.device, confirming.action)}
        />
      ) : null}
      {dialog}
    </div>
  );
}

const ERRORS = { SAVE_FAILED: 1, NOT_FOUND: 1, FORBIDDEN: 1, REAUTH_REQUIRED: 1 } as const;
const CONFIRM_KEY = { SIGN_OUT: "signOut", REVOKE: "revoke", LOST: "lost", RESTORE: "restore" } as const;
const ACTION_KEY = { SIGN_OUT: "signOut", REVOKE: "revoke", LOST: "lost", RESTORE: "restore" } as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
